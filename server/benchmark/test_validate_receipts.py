"""Tests of corpus integrity checks, with no network or third-party dependencies."""
import copy
import json
from pathlib import Path
import struct
import unittest
import zlib

from validate_receipts import InvalidDataset, png_size_without_metadata, validate_truth


class GroundTruthChecks(unittest.TestCase):
    def setUp(self):
        contract = json.loads((Path(__file__).parent / "receipts" / "FORMAT.json").read_text())
        self.truth = copy.deepcopy(contract["groundTruthExample"])

    def test_example_reconciles(self):
        validate_truth(self.truth)

    def test_subtotal_gap_is_not_hidden(self):
        self.truth["items"][0]["linePrice"] += 1
        with self.assertRaisesRegex(InvalidDataset, "subtotal is"):
            validate_truth(self.truth)

    def test_total_gap_is_not_hidden(self):
        self.truth["total"] += 1
        with self.assertRaisesRegex(InvalidDataset, "total is"):
            validate_truth(self.truth)

    def test_tax_lines_must_reconcile(self):
        self.truth["taxLines"][0]["amount"] += 1
        with self.assertRaisesRegex(InvalidDataset, "taxTotal"):
            validate_truth(self.truth)

    def test_inclusive_tax_is_not_added_twice(self):
        self.truth["taxMode"] = "inclusive"
        self.truth["total"] = 900
        validate_truth(self.truth)

    def test_staged_charges_receipt_discount_and_rounding(self):
        self.truth["receiptDiscounts"] = [{"label": "Coupon", "amount": 50}]
        self.truth["charges"] = [
            {"label": "Service", "amount": 100, "stage": "before-subtotal"},
            {"label": "Delivery", "amount": 25, "stage": "after-subtotal"},
        ]
        self.truth["subtotal"] = 950
        self.truth["rounding"] = -2
        self.truth["total"] = 1090
        validate_truth(self.truth)

    def test_printed_subtotal_before_discounts_is_preserved(self):
        self.truth["subtotalStage"] = "before-discounts"
        self.truth["subtotal"] = 1000
        validate_truth(self.truth)

    def test_unprinted_unit_price_is_allowed(self):
        self.truth["items"][0]["unitPrice"] = None
        validate_truth(self.truth)

    def test_float_money_is_rejected(self):
        self.truth["items"][0]["unitPrice"] = 10.0
        with self.assertRaisesRegex(InvalidDataset, "integer minor units"):
            validate_truth(self.truth)

    def test_missing_taxability_is_rejected(self):
        self.truth["taxability"] = []
        with self.assertRaisesRegex(InvalidDataset, "Missing per-item"):
            validate_truth(self.truth)

    def test_rule_based_taxability_needs_citation(self):
        self.truth["taxability"][0]["basis"] = "jurisdiction-rule"
        with self.assertRaisesRegex(InvalidDataset, "primary-source URL"):
            validate_truth(self.truth)

    def test_rate_is_fraction_not_percent(self):
        self.truth["taxLines"][0]["rate"] = "13"
        with self.assertRaisesRegex(InvalidDataset, "out of range"):
            validate_truth(self.truth)


class MetadataChecks(unittest.TestCase):
    @staticmethod
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    def image(self, metadata=False):
        image = b"\x89PNG\r\n\x1a\n"
        image += self.chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        if metadata:
            image += self.chunk(b"eXIf", b"private metadata")
        image += self.chunk(b"IDAT", zlib.compress(b"\0\0\0\0"))
        return image + self.chunk(b"IEND", b"")

    def test_clean_rgb_png(self):
        self.assertEqual(png_size_without_metadata(self.image()), (1, 1))

    def test_exif_is_rejected(self):
        with self.assertRaisesRegex(InvalidDataset, "metadata"):
            png_size_without_metadata(self.image(metadata=True))

    def test_data_after_end_is_rejected(self):
        with self.assertRaisesRegex(InvalidDataset, "Data after"):
            png_size_without_metadata(self.image() + b"private metadata")


if __name__ == "__main__":
    unittest.main()
