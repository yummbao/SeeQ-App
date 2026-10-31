// Deterministic, locally generated warning tones. Run from the project root.
const fs = require('node:fs');
const path = require('node:path');
const rate = 22050;
const folder = path.resolve(__dirname, '../assets/sounds');
fs.mkdirSync(folder, { recursive: true });
function writeTone(name, segments) {
  const count = segments.reduce((sum, [, ms]) => sum + Math.round(ms * rate / 1000), 0);
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
  let offset = 44;
  for (const [hz, ms] of segments) {
    const length = Math.round(ms * rate / 1000);
    for (let i = 0; i < length; i++) {
      const envelope = Math.min(1, i / (rate * 0.005), (length - i - 1) / (rate * 0.005));
      const value = hz ? Math.sin(2 * Math.PI * hz * i / rate) * envelope * 0.4 : 0;
      buffer.writeInt16LE(Math.round(value * 32767), offset); offset += 2;
    }
  }
  fs.writeFileSync(path.join(folder, name), buffer);
}
writeTone('hazard-level1.wav', [[960, 140], [0, 40], [1080, 100], [0, 40], [1080, 100], [0, 40], [1080, 100], [0, 40], [960, 650]]);
writeTone('hazard-short.wav', [[880, 140], [0, 120], [880, 140]]);
