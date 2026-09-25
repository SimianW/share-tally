#!/usr/bin/env python3
"""Validate the hand-labelled corpus offline; this is not the pipeline replay harness."""
from __future__ import annotations

import argparse
from collections import Counter
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import zlib


class InvalidDataset(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise InvalidDataset(message)


def money(value: object, field: str, *, signed: bool = False, nullable: bool = False) -> None:
    if nullable and value is None:
        return
    require(type(value) is int, f"{field} must be integer minor units")
    require(signed or value >= 0, f"{field} cannot be negative")


def decimal_string(value: object, field: str, *, rate: bool = False) -> None:
    require(isinstance(value, str) and bool(re.fullmatch(r"\d+(?:\.\d+)?", value)),
            f"{field} must be a nonnegative decimal string")
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise InvalidDataset(f"Invalid {field}") from error
    require(0 <= number <= 1 if rate else number > 0, f"{field} out of range")


def nonempty(value: object, field: str) -> None:
    require(isinstance(value, str) and bool(value.strip()), f"{field} must be nonempty text")


def url(value: object, field: str) -> None:
    require(isinstance(value, str) and value.startswith("https://"), f"{field} must be an HTTPS URL")


def validate_truth(data: dict) -> None:
    require(data["schemaVersion"] == 1, "Unsupported ground-truth schemaVersion")
    require(data["currencyExponent"] == 2, "All corpus amounts use exponent 2")
    require(bool(re.fullmatch(r"[A-Z]{3}", data["currency"])), "Invalid currency")
    require(bool(re.fullmatch(r"[A-Z]{2}", data["country"])), "Invalid country")
    nonempty(data["id"], "id")
    if data["merchant"] is not None:
        nonempty(data["merchant"], "merchant")
    require(data["taxMode"] in ("exclusive", "inclusive"), "Invalid taxMode")
    require(data["subtotalBasis"] in ("printed", "derived-items"), "Invalid subtotalBasis")
    require(isinstance(data["items"], list) and bool(data["items"]), "Receipt must have items")
    ids: set[str] = set()
    net_items = 0
    for item in data["items"]:
        require(item["id"] not in ids, "Duplicate item ID")
        ids.add(item["id"])
        nonempty(item["description"], "item.description")
        nonempty(item["quantityBasis"], "item.quantityBasis")
        if item["quantity"] is not None:
            decimal_string(item["quantity"], "item.quantity")
        money(item["unitPrice"], "item.unitPrice", nullable=True)
        money(item["linePrice"], "item.linePrice")
        money(item["ownDiscount"], "item.ownDiscount")
        require(item["ownDiscount"] <= item["linePrice"], "Own discount exceeds line price")
        require(isinstance(item["discountLabels"], list), "discountLabels must be an array")
        require(not item["ownDiscount"] or bool(item["discountLabels"]), "Own discount needs printed evidence")
        require(isinstance(item["notes"], list), "Item notes must be an array")
        net_items += item["linePrice"] - item["ownDiscount"]
    discounts = 0
    for entry in data["receiptDiscounts"]:
        nonempty(entry["label"], "receiptDiscount.label")
        money(entry["amount"], "receiptDiscount.amount")
        discounts += entry["amount"]
    charges = {"before-subtotal": 0, "after-subtotal": 0}
    for entry in data["charges"]:
        nonempty(entry["label"], "charge.label")
        require(entry["stage"] in charges, "Invalid charge stage")
        money(entry["amount"], "charge.amount", signed=True)
        charges[entry["stage"]] += entry["amount"]
    tax = 0
    for entry in data["taxLines"]:
        nonempty(entry["label"], "taxLine.label")
        nonempty(entry["rateBasis"], "taxLine.rateBasis")
        money(entry["amount"], "taxLine.amount")
        if entry["rate"] is not None:
            decimal_string(entry["rate"], "taxLine.rate", rate=True)
        tax += entry["amount"]
    for field in ("subtotal", "taxTotal", "total"):
        money(data[field], field)
    money(data["rounding"], "rounding", signed=True)
    require(tax == data["taxTotal"], "Tax lines do not sum to taxTotal")
    subtotal_stage = data.get("subtotalStage", "after-discounts")
    require(subtotal_stage in ("before-discounts", "after-discounts"), "Invalid subtotalStage")
    own_discounts = sum(item["ownDiscount"] for item in data["items"])
    deferred_discounts = own_discounts + discounts if subtotal_stage == "before-discounts" else 0
    expected_subtotal = net_items - discounts + deferred_discounts + charges["before-subtotal"]
    require(expected_subtotal == data["subtotal"],
            f"Items/discounts/charges give {expected_subtotal}, subtotal is {data['subtotal']}")
    expected_total = (data["subtotal"] - deferred_discounts + (tax if data["taxMode"] == "exclusive" else 0)
                      + charges["after-subtotal"] + data["rounding"])
    require(expected_total == data["total"],
            f"Subtotal/tax/charges/rounding give {expected_total}, total is {data['total']}")
    labelled: set[str] = set()
    for label in data["taxability"]:
        require(label["itemId"] in ids and label["itemId"] not in labelled,
                "Taxability must reference each item exactly once")
        labelled.add(label["itemId"])
        require(type(label["taxable"]) is bool, "Taxability must be a boolean")
        require(label["basis"] in ("printed-code", "printed-tax", "jurisdiction-rule"),
                "Unknown taxability basis")
        nonempty(label["evidence"], "taxability.evidence")
        require(isinstance(label["sourceUrls"], list), "Taxability sourceUrls must be an array")
        require(label["basis"] != "jurisdiction-rule" or bool(label["sourceUrls"]),
                "Jurisdiction-rule labels require a primary-source URL")
        for source in label["sourceUrls"]:
            url(source, "taxability.sourceUrl")
    require(ids == labelled, "Missing per-item taxability labels")
    require(isinstance(data["notes"], list), "Receipt notes must be an array")
    nonempty(data["review"]["method"], "review.method")
    require(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", data["review"]["date"])), "Invalid review date")


def png_size_without_metadata(image: bytes) -> tuple[int, int]:
    require(image[:8] == b"\x89PNG\r\n\x1a\n", "Image must be PNG")
    offset, size, ended = 8, None, False
    while offset < len(image):
        require(offset + 12 <= len(image), "Truncated PNG chunk")
        length = struct.unpack_from(">I", image, offset)[0]
        kind = image[offset + 4:offset + 8]
        end = offset + 12 + length
        require(end <= len(image), "Truncated PNG payload")
        require(kind in (b"IHDR", b"IDAT", b"IEND", b"PLTE", b"tRNS"),
                f"Image contains metadata or unexpected chunk {kind!r}; save a fresh RGB image")
        payload = image[offset + 8:end - 4]
        require(zlib.crc32(kind + payload) == struct.unpack_from(">I", image, end - 4)[0],
                "PNG chunk checksum mismatch")
        if kind == b"IHDR":
            require(size is None and offset == 8 and length == 13, "Invalid PNG header")
            size = struct.unpack_from(">II", payload)
        if kind == b"IEND":
            require(length == 0 and end == len(image), "Data after PNG end")
            ended = True
        offset = end
    require(size is not None and ended, "Incomplete PNG")
    return size


def validate_corpus(root: Path) -> tuple[Counter, int]:
    counts: Counter = Counter()
    ids, original_hashes, image_hashes = set(), set(), set()
    slots = 0
    manifests = sorted(root.glob("*/manifest.json"))
    require(bool(manifests), "No corpus manifests found")
    for directory in root.iterdir():
        if directory.is_dir() and any(directory.iterdir()):
            require((directory / "manifest.json").is_file(), f"{directory}: missing source manifest")
    for manifest in manifests:
        entries = json.loads(manifest.read_text())
        require(isinstance(entries, list), f"{manifest}: manifest must be an array")
        referenced = {"manifest.json"}
        for entry in entries:
            try:
                require(entry["id"] not in ids, "Duplicate receipt/slot ID")
                ids.add(entry["id"])
                if entry.get("status") == "awaiting-owner":
                    require(manifest.parent.name == "owner-slots", "Owner slot in wrong directory")
                    require(entry["image"] is None and entry["groundTruth"] is None, "Nonempty owner slot")
                    slots += 1
                    continue
                for field in ("image", "groundTruth"):
                    require(Path(entry[field]).name == entry[field], f"{field} must be a local basename")
                    referenced.add(entry[field])
                image = (manifest.parent / entry["image"]).read_bytes()
                width, height = png_size_without_metadata(image)
                require(hashlib.sha256(image).hexdigest() == entry["imageSha256"], "Image SHA256 mismatch")
                for field, seen in (("originalSha256", original_hashes), ("imageSha256", image_hashes)):
                    value = entry[field]
                    require(bool(re.fullmatch(r"[0-9a-f]{64}", value)), f"Invalid {field}")
                    require(value not in seen, f"Duplicate image by {field}")
                    seen.add(value)
                require(entry["metadataStripped"] is True, "Missing metadata stripping attestation")
                for field in ("sourceUrl", "imageUrl", "licenseUrl", "licenseEvidenceUrl"):
                    url(entry[field], field)
                for field in ("source", "attribution", "license"):
                    nonempty(entry[field], field)
                require(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry["retrievedAt"])), "Invalid retrieval date")
                require(isinstance(entry["rightsNotes"], list), "rightsNotes must be an array")
                require(isinstance(entry["redactions"], list), "redactions must be an array")
                for redaction in entry["redactions"]:
                    nonempty(redaction["reason"], "redaction.reason")
                    box = redaction["box"]
                    require(len(box) == 4 and all(type(v) is int for v in box), "Invalid redaction box")
                    x1, y1, x2, y2 = box
                    require(0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height,
                            "Redaction box outside committed image")
                truth = json.loads((manifest.parent / entry["groundTruth"]).read_text())
                require(truth["id"] == entry["id"], "Manifest/label ID mismatch")
                require(type(entry["nonCanadian"]) is bool and entry["nonCanadian"] == (truth["country"] != "CA"),
                        "Wrong nonCanadian marker")
                validate_truth(truth)
                counts[entry["source"]] += 1
            except (KeyError, TypeError, ValueError, OSError) as error:
                raise InvalidDataset(f"{manifest.parent.name}/{entry.get('id', '?')}: {error}") from error
        # Avoid accidentally committing originals, raw OCR, contact sheets, or scratch labels.
        actual = {file.name for file in manifest.parent.iterdir() if file.is_file()}
        require(actual == referenced, f"{manifest.parent}: unreferenced or missing files: {actual ^ referenced}")
    return counts, slots


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).parent / "receipts")
    parser.add_argument("--expected-receipts", type=int, default=24)
    parser.add_argument("--expected-owner-slots", type=int, default=0)
    args = parser.parse_args()
    try:
        counts, slots = validate_corpus(args.root)
        require(sum(counts.values()) == args.expected_receipts,
                f"Expected {args.expected_receipts} receipts, found {sum(counts.values())}")
        require(slots == args.expected_owner_slots,
                f"Expected {args.expected_owner_slots} owner slots, found {slots}")
    except (InvalidDataset, OSError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print(f"PASS: {sum(counts.values())} receipts; {slots} empty owner slots")
    for source, count in sorted(counts.items()):
        print(f"  {source}: {count}")
    print("Checked labels, exact arithmetic, hashes, duplicate images, provenance fields and PNG metadata.")
    print("Visual transcription, tax-rule interpretation, redaction completeness and rights need human review.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
