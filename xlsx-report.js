const encoder = new TextEncoder();

function xmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let n = index + 1;
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function safeSheetName(name, used) {
  const base = String(name || 'Sheet').replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const tail = ` ${suffix++}`;
    candidate = `${base.slice(0, Math.max(1, 31 - tail.length))}${tail}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
  return { time, day };
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function u16(value) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return encoder.encode(String(value));
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = toBytes(file.data);
    let payload = data;
    let method = 0;
    if (data.length > 256 && !/\.png$/i.test(file.name)) {
      const compressed = await deflateRaw(data);
      if (compressed && compressed.length < data.length) { payload = compressed; method = 8; }
    }
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(payload.length), u32(data.length), u16(name.length), u16(0), name, payload,
    ]);
    localParts.push(local);
    const central = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(payload.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(offset), u16(0),
  ]);
  return concatBytes([...localParts, ...centralParts, eocd]);
}

function normalizeCell(value, style = 4) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'v')) {
    return { style, ...value };
  }
  return { v: value, style };
}

function cellXml(cell, rowIndex, colIndex, hyperlinks) {
  if (cell == null) return '';
  const normalized = normalizeCell(cell);
  const ref = `${columnName(colIndex)}${rowIndex}`;
  const style = normalized.style == null ? 4 : normalized.style;
  if (normalized.link) hyperlinks.push({ ref, location: normalized.link, display: normalized.v });
  if (normalized.formula) return `<c r="${ref}" s="${style}"><f>${xmlEscape(normalized.formula)}</f>${normalized.v == null ? '' : `<v>${xmlEscape(normalized.v)}</v>`}</c>`;
  if (normalized.v == null || normalized.v === '') return `<c r="${ref}" s="${style}" t="inlineStr"><is><t></t></is></c>`;
  if (typeof normalized.v === 'number' && Number.isFinite(normalized.v)) return `<c r="${ref}" s="${style}"><v>${normalized.v}</v></c>`;
  if (typeof normalized.v === 'boolean') return `<c r="${ref}" s="${style}" t="b"><v>${normalized.v ? 1 : 0}</v></c>`;
  const text = String(normalized.v);
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${preserve}>${xmlEscape(text)}</t></is></c>`;
}

function sheetXml(sheet) {
  const hyperlinks = [];
  let maxCol = 1;
  const rowsXml = sheet.rows.map((row, index) => {
    maxCol = Math.max(maxCol, row.cells.length);
    const rowNumber = index + 1;
    const cells = row.cells.map((cell, col) => cellXml(cell, rowNumber, col, hyperlinks)).join('');
    const height = row.height ? ` ht="${row.height}" customHeight="1"` : '';
    return `<row r="${rowNumber}"${height}>${cells}</row>`;
  }).join('');
  const columns = (sheet.columns || []).map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Number(width) || 12}" customWidth="1"/>`).join('');
  const merges = (sheet.merges || []).map((ref) => `<mergeCell ref="${ref}"/>`).join('');
  const hyperlinksXml = hyperlinks.length ? `<hyperlinks>${hyperlinks.map((item) => `<hyperlink ref="${item.ref}" location="${xmlEscape(item.location)}" display="${xmlEscape(item.display ?? '')}"/>`).join('')}</hyperlinks>` : '';
  const freeze = sheet.freeze ? (() => { const cols = sheet.freeze.columns || 0; const rows = sheet.freeze.rows || 0; const activePane = cols && rows ? 'bottomRight' : cols ? 'topRight' : 'bottomLeft'; return `<sheetViews><sheetView workbookViewId="0"><pane${cols ? ` xSplit="${cols}"` : ''}${rows ? ` ySplit="${rows}"` : ''} topLeftCell="${columnName(cols)}${rows + 1}" activePane="${activePane}" state="frozen"/></sheetView></sheetViews>`; })() : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const autoFilter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : '';
  const drawing = sheet.images?.length ? '<drawing r:id="rId1"/>' : '';
  const dimension = `A1:${columnName(Math.max(0, maxCol - 1))}${Math.max(1, sheet.rows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="${dimension}"/>${freeze}<sheetFormatPr defaultRowHeight="18"/>${columns ? `<cols>${columns}</cols>` : ''}<sheetData>${rowsXml}</sheetData>${autoFilter}${merges ? `<mergeCells count="${sheet.merges.length}">${merges}</mergeCells>` : ''}${hyperlinksXml}<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>${drawing}</worksheet>`;
}

function drawingXml(images) {
  const anchors = images.map((image, index) => {
    const col = image.col || 0;
    const row = image.row || 0;
    const width = Math.max(1, image.width || 800);
    const height = Math.max(1, image.height || 500);
    const id = index + 1;
    return `<xdr:oneCellAnchor>
<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:ext cx="${Math.round(width * 9525)}" cy="${Math.round(height * 9525)}"/>
<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${xmlEscape(image.name || `Image ${id}`)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(width * 9525)}" cy="${Math.round(height * 9525)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/>
</xdr:oneCellAnchor>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
}

function drawingRelsXml(images, mediaStart) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${images.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${mediaStart + index}.png"/>`).join('')}</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0000"/><numFmt numFmtId="165" formatCode="0.00%"/></numFmts>
<fonts count="7">
<font><sz val="10"/><name val="Aptos"/></font>
<font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
<font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Aptos"/></font>
<font><sz val="10"/><color rgb="FF0F172A"/><name val="Aptos"/></font>
<font><u/><sz val="10"/><color rgb="FF2563EB"/><name val="Aptos"/></font>
<font><i/><sz val="9"/><color rgb="FF64748B"/><name val="Aptos"/></font>
</fonts>
<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="165" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
}

function workbookXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
}

function workbookRelsXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function contentTypesXml(sheets, drawings, mediaCount) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${mediaCount ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${drawings.map((_, index) => `<Override PartName="/xl/drawings/drawing${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function coreXml(title, createdAt) {
  const iso = new Date(createdAt || Date.now()).toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)}</dc:title><dc:creator>BGA Land Mapper</dc:creator><cp:lastModifiedBy>BGA Land Mapper</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;
}

function appXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>BGA Land Mapper</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map((sheet) => `<vt:lpstr>${xmlEscape(sheet.name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`;
}

function row(cells, height = null) { return { cells, height }; }
function titleRow(text, width = 8) { return { rows: [row([{ v: text, style: 1 }, ...Array(width - 1).fill(null)], 32)], merge: `A1:${columnName(width - 1)}1` }; }

function makeSummarySheet(report, used) {
  const name = safeSheetName('Summary', used);
  const width = 8;
  const title = titleRow(report.title || 'Component CAD Report', width);
  const rows = [...title.rows,
    row([{ v: 'Board', style: 3 }, { v: report.boardName || '—', style: 4 }, { v: 'CAD file', style: 3 }, { v: report.cadFileName || '—', style: 4 }, { v: 'Generated', style: 3 }, { v: new Date(report.generatedAt).toLocaleString('th-TH'), style: 4 }]),
    row([{ v: 'X-ray file', style: 3 }, { v: report.xlsxFileName || '—', style: 4 }, { v: 'Name source', style: 3 }, { v: report.nameSourceLabel || 'Active CAD', style: 4 }, { v: 'Zone grid', style: 3 }, { v: `${report.zoneGrid} × ${report.zoneGrid}`, style: 4 }]),
    row([{ v: 'Project ID', style: 3 }, { v: report.projectMetadata?.projectId || '—', style: 4 }, { v: 'Revision', style: 3 }, { v: report.projectMetadata?.revisionNumber ?? 0, style: 6 }, { v: 'Validation', style: 3 }, { v: report.projectMetadata?.validationStatus || 'not-run', style: 4 }]),
    row([{ v: 'Source format', style: 3 }, { v: report.projectMetadata?.sourceFormat || 'unknown', style: 4 }, { v: 'Export format', style: 3 }, { v: report.projectMetadata?.exportFormat || 'xlsx-component-report', style: 4 }, { v: 'Accepted warnings', style: 3 }, { v: (report.projectMetadata?.acceptedWarnings || []).map((item) => typeof item === 'string' ? item : item?.code || item?.id || '').filter(Boolean).join(' | ') || '—', style: 4 }]),
    row([]),
    row(['Component', 'Package', 'CAD lands', 'X-ray lands', 'Measurement values', 'Duplicate positions', 'Map sheet', 'Land data'].map((v) => ({ v, style: 2 })), 28),
  ];
  for (const component of report.components) {
    rows.push(row([
      { v: component.name, style: 4 }, { v: component.packageName || '', style: 4 }, { v: component.rows.length, style: 6 },
      { v: component.rows.filter((item) => item.xrayLand != null).length, style: 6 }, { v: component.measurementCount, style: 6 },
      { v: component.rows.filter((item) => item.duplicateCount > 1).length, style: 6 },
      { v: component.mapSheetName, style: 8, link: `'${component.mapSheetName.replace(/'/g, "''")}'!A1` },
      { v: component.dataSheetName, style: 8, link: `'${component.dataSheetName.replace(/'/g, "''")}'!A1` },
    ]));
  }
  rows.push(row([]), row([{ v: 'คำอธิบาย', style: 3 }]), row([{ v: 'ภาพรวมแบ่ง Component เป็นโซน ตัวอย่าง A1 หมายถึงแถวบนสุด คอลัมน์ซ้ายสุด การคลิกชื่อโซนหรือ Zone ในตารางจะพาไปยังภาพขยายของโซนนั้น', style: 9 }], 42));
  return { name, rows, merges: [title.merge], columns: [18, 28, 14, 14, 18, 18, 20, 20], freeze: { rows: 7, columns: 0 }, images: [] };
}

function makeMapSheet(component, used) {
  const name = component.mapSheetName;
  const width = 10;
  const title = titleRow(`${component.name} · Component Map`, width);
  const rows = [...title.rows,
    row([{ v: 'Package', style: 3 }, { v: component.packageName || '—', style: 4 }, { v: 'CAD lands', style: 3 }, { v: component.rows.length, style: 6 }, { v: 'X-ray mapped', style: 3 }, { v: component.rows.filter((item) => item.xrayLand != null).length, style: 6 }]),
    row([{ v: 'Measurement', style: 3 }, { v: component.measurementCount, style: 6 }, { v: 'Bounds X', style: 3 }, { v: `${component.bounds.minX.toFixed(4)} – ${component.bounds.maxX.toFixed(4)}`, style: 4 }, { v: 'Bounds Y', style: 3 }, { v: `${component.bounds.minY.toFixed(4)} – ${component.bounds.maxY.toFixed(4)}`, style: 4 }]),
    ...Array(45).fill(0).map(() => row([])),
    row([{ v: 'Zone', style: 2 }, { v: 'Land count', style: 2 }, { v: 'Measurement count', style: 2 }, { v: 'Min X', style: 2 }, { v: 'Max X', style: 2 }, { v: 'Min Y', style: 2 }, { v: 'Max Y', style: 2 }, { v: 'เปิดภาพขยาย', style: 2 }]),
  ];
  for (const zone of component.zones) {
    rows.push(row([
      { v: zone.label, style: 4 }, { v: zone.rows.length, style: 6 }, { v: zone.rows.filter((item) => Number.isFinite(Number(item.measurement))).length, style: 6 },
      { v: zone.bounds.minX, style: 5 }, { v: zone.bounds.maxX, style: 5 }, { v: zone.bounds.minY, style: 5 }, { v: zone.bounds.maxY, style: 5 },
      { v: zone.sheetName, style: 8, link: `'${zone.sheetName.replace(/'/g, "''")}'!A1` },
    ]));
  }
  return {
    name, rows, merges: [title.merge], columns: [14, 16, 20, 14, 14, 14, 14, 22, 14, 14],
    images: [{ bytes: component.overviewPng, row: 4, col: 0, width: 1450, height: 820, name: `${component.name} overview` }],
  };
}

const DATA_HEADERS = ['Part', 'Package', 'Zone', 'Local', 'X-ray Land', 'XML ID', 'CAD Name', 'Original Name', 'Generated Name', 'X', 'Y', 'Width', 'Length', 'Measurement', 'Confirmed', 'Mapping status', 'Duplicate count'];
function dataRow(item, zoneLink = null) {
  return [
    { v: item.componentName, style: 4 }, { v: item.packageName, style: 4 }, zoneLink ? { v: item.zone, style: 8, link: zoneLink } : { v: item.zone, style: 4 },
    { v: item.localIndex, style: 6 }, { v: item.xrayLand, style: 6 }, { v: item.globalId, style: 6 }, { v: item.cadName, style: 4 },
    { v: item.originalCadName, style: 4 }, { v: item.generatedCadName, style: 4 }, { v: item.centerX, style: 5 }, { v: item.centerY, style: 5 },
    { v: item.width, style: 5 }, { v: item.length, style: 5 }, { v: item.measurement, style: 5 }, { v: item.confirmed ? 'Yes' : 'No', style: item.confirmed ? 11 : 10 },
    { v: item.mappingStatus, style: 4 }, { v: item.duplicateCount, style: 6 },
  ];
}

function makeDataSheet(component) {
  const title = titleRow(`${component.name} · Land Data`, DATA_HEADERS.length);
  const rows = [...title.rows,
    row([{ v: `ข้อมูลตำแหน่งทั้งหมดของ ${component.name} · คลิก Zone เพื่อเปิดภาพขยาย`, style: 9 }], 28),
    row(DATA_HEADERS.map((v) => ({ v, style: 2 })), 30),
  ];
  const zoneByLabel = new Map(component.zones.map((zone) => [zone.label, zone]));
  for (const item of component.rows) {
    const zone = zoneByLabel.get(item.zone);
    const link = zone ? `'${zone.sheetName.replace(/'/g, "''")}'!A1` : null;
    rows.push(row(dataRow(item, link)));
  }
  return { name: component.dataSheetName, rows, merges: [title.merge, `A2:${columnName(DATA_HEADERS.length - 1)}2`], columns: [12, 26, 10, 10, 12, 12, 14, 16, 16, 12, 12, 11, 11, 14, 12, 18, 14], freeze: { rows: 3, columns: 3 }, autoFilter: `A3:${columnName(DATA_HEADERS.length - 1)}${rows.length}`, images: [] };
}

function makeZoneSheet(component, zone, compact = true) {
  const width = DATA_HEADERS.length;
  const title = titleRow(`${component.name} · Zone ${zone.label}`, width);
  if (compact) {
    const rows = [...title.rows,
      row([{ v: `X ${zone.bounds.minX.toFixed(4)} – ${zone.bounds.maxX.toFixed(4)} · Y ${zone.bounds.minY.toFixed(4)} – ${zone.bounds.maxY.toFixed(4)} · ${zone.rows.length} lands`, style: 9 }], 28),
      row([{ v: 'เปิดชีต Land Data เพื่อดูข้อมูลครบทุก Land', style: 8, link: `'${component.dataSheetName.replace(/'/g, "''")}'!A1` }], 24),
      ...Array(44).fill(0).map(() => row([])),
    ];
    return { name: zone.sheetName, rows, merges: [title.merge, `A2:${columnName(width - 1)}2`, `A3:${columnName(width - 1)}3`], columns: [12, 26, 10, 10, 12, 12, 14, 16, 16, 12, 12, 11, 11, 14, 12, 18, 14], images: [{ bytes: zone.imagePng, row: 4, col: 0, width: 1450, height: 800, name: `${component.name} zone ${zone.label}` }] };
  }
  const rows = [...title.rows, row([{ v: `X ${zone.bounds.minX.toFixed(4)} – ${zone.bounds.maxX.toFixed(4)} · Y ${zone.bounds.minY.toFixed(4)} – ${zone.bounds.maxY.toFixed(4)} · ${zone.rows.length} lands`, style: 9 }], 28), ...Array(44).fill(0).map(() => row([])), row(DATA_HEADERS.map((v) => ({ v, style: 2 })), 30)];
  for (const item of zone.rows) rows.push(row(dataRow(item)));
  return { name: zone.sheetName, rows, merges: [title.merge, `A2:${columnName(width - 1)}2`], columns: [12, 26, 10, 10, 12, 12, 14, 16, 16, 12, 12, 11, 11, 14, 12, 18, 14], freeze: { rows: 47, columns: 3 }, autoFilter: zone.rows.length ? `A47:${columnName(width - 1)}${rows.length}` : null, images: [{ bytes: zone.imagePng, row: 3, col: 0, width: 1450, height: 800, name: `${component.name} zone ${zone.label}` }] };
}
function makeHistogramSheet(component) {
  const title = titleRow(`${component.name} · Measurement Histogram`, 8);
  const rows = [...title.rows,
    row([{ v: 'Count', style: 3 }, { v: component.histogram.stats.count, style: 6 }, { v: 'Min', style: 3 }, { v: component.histogram.stats.min, style: 5 }, { v: 'Average', style: 3 }, { v: component.histogram.stats.average, style: 5 }, { v: 'Max', style: 3 }, { v: component.histogram.stats.max, style: 5 }]),
    ...Array(31).fill(0).map(() => row([])),
    row(['Bin', 'Lower', 'Upper', 'Count', 'Percent', 'Cumulative count', 'Cumulative percent', ''].map((v) => ({ v, style: 2 })), 28),
  ];
  for (const bin of component.histogram.bins) rows.push(row([
    { v: bin.index + 1, style: 6 }, { v: bin.low, style: 5 }, { v: bin.high, style: 5 }, { v: bin.count, style: 6 }, { v: bin.percent / 100, style: 7 }, { v: bin.cumulative, style: 6 }, { v: bin.cumulativePercent / 100, style: 7 }, null,
  ]));
  return { name: component.histogramSheetName, rows, merges: [title.merge], columns: [10, 14, 14, 12, 14, 18, 20, 10], freeze: { rows: 35, columns: 0 }, images: component.histogram.imagePng ? [{ bytes: component.histogram.imagePng, row: 3, col: 0, width: 1150, height: 540, name: `${component.name} histogram` }] : [] };
}

function makeNameChangesSheet(report, used) {
  const changes = [];
  for (const component of report.components) for (const item of component.rows) if (item.originalCadName !== item.generatedCadName && (item.originalCadName || item.generatedCadName)) changes.push(item);
  if (!changes.length) return null;
  const name = safeSheetName('CAD Name Changes', used);
  const headers = ['Part', 'Local', 'XML ID', 'Original Name', 'Generated Name', 'X', 'Y', 'Zone'];
  const title = titleRow('Original CAD ↔ Generated CAD Name Changes', headers.length);
  const rows = [...title.rows, row(headers.map((v) => ({ v, style: 2 })), 30)];
  for (const item of changes) rows.push(row([{ v: item.componentName, style: 4 }, { v: item.localIndex, style: 6 }, { v: item.globalId, style: 6 }, { v: item.originalCadName, style: 4 }, { v: item.generatedCadName, style: 4 }, { v: item.centerX, style: 5 }, { v: item.centerY, style: 5 }, { v: item.zone, style: 4 }]));
  return { name, rows, merges: [title.merge], columns: [14, 10, 12, 18, 18, 14, 14, 10], freeze: { rows: 2, columns: 1 }, autoFilter: `A2:H${rows.length}`, images: [] };
}

function makeDuplicatesSheet(report, used) {
  const duplicates = [];
  for (const component of report.components) for (const item of component.rows) if (item.duplicateCount > 1) duplicates.push(item);
  if (!duplicates.length) return null;
  const name = safeSheetName('Duplicate Names', used);
  const headers = ['Part', 'CAD Name', 'Duplicate count', 'Local', 'X-ray Land', 'XML ID', 'X', 'Y', 'Zone'];
  const title = titleRow('Duplicate CAD Names', headers.length);
  const rows = [...title.rows, row(headers.map((v) => ({ v, style: 2 })), 30)];
  for (const item of duplicates) rows.push(row([{ v: item.componentName, style: 4 }, { v: item.cadName, style: 10 }, { v: item.duplicateCount, style: 6 }, { v: item.localIndex, style: 6 }, { v: item.xrayLand, style: 6 }, { v: item.globalId, style: 6 }, { v: item.centerX, style: 5 }, { v: item.centerY, style: 5 }, { v: item.zone, style: 4 }]));
  return { name, rows, merges: [title.merge], columns: [14, 18, 16, 10, 12, 12, 14, 14, 10], freeze: { rows: 2, columns: 2 }, autoFilter: `A2:I${rows.length}`, images: [] };
}

export async function buildComponentReportXlsx(report) {
  const used = new Set();
  for (const component of report.components) {
    component.mapSheetName = safeSheetName(`Map ${component.name}`, used);
    component.dataSheetName = safeSheetName(`Data ${component.name}`, used);
    component.histogramSheetName = safeSheetName(`Histogram ${component.name}`, used);
    for (const zone of component.zones) zone.sheetName = safeSheetName(`${component.name} Zone ${zone.label}`, used);
  }
  const summary = makeSummarySheet(report, used);
  // Summary must be first; if its reserved name collides, regenerate component names safely.
  const sheets = [summary];
  for (const component of report.components) {
    sheets.push(makeMapSheet(component, used));
    sheets.push(makeDataSheet(component));
    for (const zone of component.zones) sheets.push(makeZoneSheet(component, zone, report.compatibilityMode !== false));
    if (component.histogram?.bins?.length) sheets.push(makeHistogramSheet(component));
  }
  const changes = makeNameChangesSheet(report, used); if (changes) sheets.push(changes);
  const duplicates = makeDuplicatesSheet(report, used); if (duplicates) sheets.push(duplicates);

  const files = [];
  const drawings = [];
  const media = [];
  let drawingIndex = 0;
  let mediaIndex = 1;
  sheets.forEach((sheet, index) => {
    files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet) });
    if (sheet.images?.length) {
      drawingIndex += 1;
      drawings.push(sheet);
      files.push({ name: `xl/worksheets/_rels/sheet${index + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/></Relationships>` });
      files.push({ name: `xl/drawings/drawing${drawingIndex}.xml`, data: drawingXml(sheet.images) });
      files.push({ name: `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`, data: drawingRelsXml(sheet.images, mediaIndex) });
      for (const image of sheet.images) {
        media.push({ name: `xl/media/image${mediaIndex}.png`, data: image.bytes });
        mediaIndex += 1;
      }
    }
  });
  files.push({ name: '[Content_Types].xml', data: contentTypesXml(sheets, drawings, media.length) });
  files.push({ name: '_rels/.rels', data: rootRelsXml() });
  files.push({ name: 'xl/workbook.xml', data: workbookXml(sheets) });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml(sheets) });
  files.push({ name: 'xl/styles.xml', data: stylesXml() });
  files.push({ name: 'docProps/core.xml', data: coreXml(report.title || 'Component CAD Report', report.generatedAt) });
  files.push({ name: 'docProps/app.xml', data: appXml(sheets) });
  files.push(...media);
  return new Blob([await buildZip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export const __test = { buildZip, xmlEscape, safeSheetName };
