export function validateCapture(value) {
  if (value?.file_header?.magic !== 'LSCP' || value.file_header.major_version !== 1 || !Array.isArray(value.records) || !value.records.length) throw new Error('The sample is not a supported capture.');
  const ids = new Set();
  for (const frame of value.records) {
    if (frame?.synthetic !== true || !Number.isInteger(frame.sequence) || frame.sequence < 0 || ids.has(frame.sequence) || !['timestamp_us','rssi_dbm_x10','snr_db_x10','center_frequency_hz','bandwidth_hz','spreading_factor'].every(key=>Number.isFinite(frame[key])) || !['receive','transmit'].includes(frame.direction_name) || ![0,1,2,3].includes(frame.crc_state) || !Number.isInteger(frame.captured_length) || !Number.isInteger(frame.original_length) || typeof frame.payload_hex !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(frame.payload_hex) || frame.payload_hex.length !== frame.captured_length * 2 || frame.original_length < frame.captured_length) throw new Error('The sample contains an invalid or non-synthetic frame.');
    ids.add(frame.sequence);
  }
  return value.records;
}
export function captureFrames(records, filter='all') {
  if (filter === 'crc') return records.filter(frame=>frame.crc_state===3);
  if (filter === 'truncated') return records.filter(frame=>frame.captured_length<frame.original_length);
  return records;
}
export function crcLabel(frame) {
  return ['Unknown','Not present','Valid','Failed'][frame.crc_state] || 'Unknown';
}
export function frameState(frame) {
  return frame.crc_state===3 ? 'CRC failed' : frame.captured_length<frame.original_length ? 'Truncated' : `CRC ${crcLabel(frame).toLowerCase()}`;
}
export function frameExplanation(frame) {
  if (frame.crc_state===3) return 'This generated frame fails its CRC check. A receiver would treat the integrity of these bytes as uncertain; a protocol label would not make them trustworthy.';
  if (frame.captured_length<frame.original_length) return `Only ${frame.captured_length} of ${frame.original_length} bytes were captured. The missing ${frame.original_length-frame.captured_length} bytes remain missing; CRC status alone does not make this stored record complete.`;
  if (frame.crc_state!==2) return 'This generated record does not report a valid CRC check. Raw bytes and signal measurements alone do not establish payload integrity or identify a protocol.';
  return 'This generated frame carries signal measurements and raw bytes. CRC validity describes an integrity check; it does not identify a protocol or decrypt a payload.';
}
export function hexRows(hex) {
  const bytes=hex.match(/.{2}/g) || [];
  const rows=[];
  for(let i=0;i<bytes.length;i+=16) rows.push(`${i.toString(16).padStart(4,'0')}  ${bytes.slice(i,i+16).join(' ')}`);
  return rows.join('\n');
}
