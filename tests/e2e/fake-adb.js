// Stand-in for adb (and, with ORCH_FAKE_EMULATOR=1, for the emulator binary) used by the device tests.
// State lives in the JSON file named by FAKE_ADB_STATE; every call is appended to st.calls.
const fs = require('fs');
const file = process.env.FAKE_ADB_STATE;
const st = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(st));
const a = process.argv.slice(2);
st.calls = (st.calls || []).concat([a.join(' ')]); save();
const fail = (m, code = 1) => { process.stderr.write(m + '\n'); process.exit(code); };

if (process.env.ORCH_FAKE_EMULATOR) {
  if (a[0] === '-list-avds') process.stdout.write((st.avds || []).join('\n') + '\n');
  else if (a[0] === '-avd') { st.started = (st.started || []).concat([a[1]]); st.devices = (st.devices || []).concat([{ serial: 'emulator-5556', state: 'device', model: a[1] }]); save(); }
  else fail('unexpected emulator args');
  process.exit(0);
}

const i = a.indexOf('-s');
const serial = i >= 0 ? a[i + 1] : '';
const rest = i >= 0 ? a.slice(i + 2) : a;

if (a[0] === 'devices') {
  process.stdout.write('List of devices attached\n' + (st.devices || []).map((d) => `${d.serial}\t${d.state}\tproduct:sdk model:${d.model} device:emu`).join('\n') + '\n');
} else if (rest[0] === 'shell' && rest[1] === 'wm') {
  process.stdout.write('Physical size: 1080x2400\n');
} else if (rest[0] === 'exec-out' && rest[1] === 'screencap') {
  process.stdout.write(Buffer.from(st.png, 'base64'));
} else if (rest[0] === 'exec-out' && rest[1] === 'screenrecord') {
  if (st.streamFail) fail('screenrecord: not supported on this device', 1);
  const data = fs.readFileSync(st.stream.file);
  let n = 0;
  const next = () => {
    if (n >= st.stream.frames.length) { process.exit(0); } // like screenrecord reaching its time limit
    const [off, len] = st.stream.frames[n++];
    process.stdout.write(data.subarray(off, off + len), () => setTimeout(next, st.stream.delayMs));
  };
  next();
  return;
} else if (rest[0] === 'shell' && rest[1] === 'uiautomator') {
  process.stdout.write('<?xml version="1.0"?><hierarchy><node text="Sign in" resource-id="app:id/signin" class="android.widget.Button" clickable="true" bounds="[100,200][500,300]"/><node text="Welcome" resource-id="" class="android.widget.TextView" clickable="false" bounds="[0,0][1080,100]"/></hierarchy>\n');
} else if (rest[0] === 'shell') {
  // input tap / swipe / text / keyevent, monkey: accepted
} else if (rest[0] === 'emu' && rest[1] === 'kill') {
  st.devices = (st.devices || []).filter((d) => d.serial !== serial); save();
} else fail('unexpected: ' + a.join(' '));
