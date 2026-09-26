import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const sourceExtensions = new Set(['.css', '.ts', '.tsx']);
const allowedFile = (file) => ['tokens.css', 'palettes.css'].includes(path.basename(file).toLowerCase());
const fontFaceFile = (file) => path.basename(file).toLowerCase() === 'fonts.css';

const namedColors = new Set(`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/));
const colorProperties = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left|inline|block))?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|text-decoration-color|column-rule(?:-color)?|fill|stroke|stop-color|flood-color|lighting-color|caret-color|accent-color|(?:--[\w-]+))$/i;
const colorSyntax = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/i;
const genericFonts = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

async function listSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSources(fullPath));
    else if (sourceExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function inspectCss(text, file, errors) {
  const declaration = /([\w-]+)\s*:\s*([^;{}]+)/g;
  for (const match of text.matchAll(declaration)) {
    const property = match[1].toLowerCase();
    const value = match[2].trim();
    const line = text.slice(0, match.index).split('\n').length;
    if (colorProperties.test(property)) {
      if (colorSyntax.test(value)) errors.push(`${file}:${line}: use a design token instead of a literal color (${property}: ${value})`);
      else {
        const words = value.replace(/var\(\s*--[\w-]+\s*\)/gi, '').toLowerCase().match(/[a-z]+/g) ?? [];
        const found = words.find((word) => namedColors.has(word));
        if (found) errors.push(`${file}:${line}: use a design token instead of the named color "${found}"`);
      }
    }
    if (property === 'font-family' && !fontFaceFile(file)) checkFontValue(value, file, line, errors);
    // A font shorthand may also specify a family after its size/line-height.
    if (property === 'font' && !fontFaceFile(file)) {
      const family = value.match(/\b(?:\d*\.)?\d+(?:px|rem|em|%)\s*(?:\/\s*[\w.%-]+)?\s+(.+)$/i)?.[1];
      if (family) checkFontValue(family, file, line, errors);
    }
  }
}

function checkFontValue(value, file, line, errors) {
  const families = value.split(',').map((part) => part.trim().replace(/^(['"])(.*)\1$/, '$2').toLowerCase());
  const explicit = families.find((family) => family && !/var\(\s*--[\w-]+\s*\)/i.test(family) && !genericFonts.has(family));
  if (explicit) errors.push(`${file}:${line}: use a font token instead of an explicit font family (font-family: ${value})`);
}

function maskNonStyleStrings(text) {
  const styleKeys = 'color|backgroundColor|borderColor|borderTopColor|borderRightColor|borderBottomColor|borderLeftColor|outlineColor|textDecorationColor|fill|stroke|caretColor|accentColor|boxShadow|textShadow|fontFamily';
  const output = [...text];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('//', index)) {
      while (index < text.length && text[index] !== '\n') output[index++] = ' ';
      continue;
    }
    if (text.startsWith('/*', index)) {
      output[index++] = ' ';
      output[index++] = ' ';
      while (index < text.length && !text.startsWith('*/', index)) {
        if (text[index] !== '\n') output[index] = ' ';
        index++;
      }
      if (index < text.length) { output[index++] = ' '; output[index++] = ' '; }
      continue;
    }
    const quote = text[index];
    if (quote !== "'" && quote !== '"' && quote !== '`') { index++; continue; }
    let end = index + 1;
    while (end < text.length) {
      if (text[end] === '\\') { end += 2; continue; }
      if (text[end++] === quote) break;
    }
    const prefix = text.slice(0, index);
    const isStyleValue = new RegExp(`(?:^|[{,])\\s*(?:${styleKeys})\\s*:\\s*$`).test(prefix);
    if (!isStyleValue) {
      for (let char = index; char < end; char++) if (text[char] !== '\n') output[char] = ' ';
    }
    index = end;
  }
  return output.join('');
}

function inspectTypescript(text, file, errors) {
  const code = maskNonStyleStrings(text);
  const stylingProperty = /\b(color|backgroundColor|borderColor|borderTopColor|borderRightColor|borderBottomColor|borderLeftColor|outlineColor|textDecorationColor|fill|stroke|caretColor|accentColor|boxShadow|textShadow)\s*:\s*([^,}\n]+)/gi;
  const styledRanges = [];
  for (const match of code.matchAll(stylingProperty)) {
    styledRanges.push([match.index, match.index + match[0].length]);
    const value = match[2].trim();
    const line = text.slice(0, match.index).split('\n').length;
    if (colorSyntax.test(value)) errors.push(`${file}:${line}: use a design token instead of a literal color (${match[1]}: ${value})`);
    else {
      const words = value.replace(/var\(\s*--[\w-]+\s*\)/gi, '').toLowerCase().match(/[a-z]+/g) ?? [];
      const found = words.find((word) => namedColors.has(word));
      if (found) errors.push(`${file}:${line}: use a design token instead of the named color "${found}"`);
    }
  }
  // Also catch keyed color lookup data such as { Simon: '#abc' }, without reading arbitrary strings.
  const literalColor = /(['"`])\s*(#[\da-f]{3,8}|rgba?\s*\([^)]*\)|hsla?\s*\([^)]*\))\s*\1/gi;
  for (const match of text.matchAll(literalColor)) {
    if (styledRanges.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const before = code.slice(0, match.index);
    if (!/(?:^|[{,])\s*[\w$]+\s*:\s*$/.test(before)) continue;
    const line = text.slice(0, match.index).split('\n').length;
    errors.push(`${file}:${line}: use a design token instead of a literal color (${match[2]})`);
  }
  const fontFamily = /\bfontFamily\s*:\s*([^,}\n]+)/g;
  for (const match of code.matchAll(fontFamily)) {
    const value = match[1].trim();
    const line = text.slice(0, match.index).split('\n').length;
    checkFontValue(value, file, line, errors);
  }
}
const errors = [];
for (const file of await listSources(srcDir)) {
  if (allowedFile(file)) continue;
  const text = await readFile(file, 'utf8');
  const relative = path.relative(srcDir, file).split(path.sep).join('/');
  if (path.extname(file).toLowerCase() === '.css') inspectCss(text, relative, errors);
  else inspectTypescript(text, relative, errors);
}

if (errors.length) {
  console.error(`Design token check failed with ${errors.length} violation${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors) console.error(`  ${error}`);
  process.exitCode = 1;
} else {
  console.log('Design token check passed.');
}
