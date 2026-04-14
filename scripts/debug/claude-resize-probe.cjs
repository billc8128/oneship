const fs = require('node:fs');
const path = require('node:path');
const pty = require(path.join(__dirname, '..', '..', 'node_modules', 'node-pty'));

const profile = process.argv[2] ?? 'oneship';
const outputPath =
  process.argv[3] ?? path.join('/tmp', `claude-${profile}-resize-probe.json`);

const overridesByProfile = {
  oneship: {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'oneship',
    TERM_PROGRAM_VERSION: '1.0.0',
  },
  ghostty: {
    TERM: 'xterm-ghostty',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'ghostty',
    TERM_PROGRAM_VERSION: '1.3.1',
    TERMINFO: '/Applications/Ghostty.app/Contents/Resources/terminfo',
  },
  hybrid: {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'ghostty',
    TERM_PROGRAM_VERSION: '1.3.1',
  },
};

const overrides = overridesByProfile[profile];
if (!overrides) {
  console.error(`Unknown profile: ${profile}`);
  process.exit(2);
}

const env = { ...process.env, ...overrides };
let transcript = '';
const markers = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mark(label) {
  markers.push({ label, offset: transcript.length, at: new Date().toISOString() });
}

function escapeForJson(value) {
  return value
    .replace(/\u001b/g, '\\u001b')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n\n');
}

function buildSections() {
  return markers.slice(1).map((marker, index) => ({
    from: markers[index].label,
    to: marker.label,
    text: escapeForJson(transcript.slice(markers[index].offset, marker.offset)),
  }));
}

async function main() {
  const shell = process.env.SHELL || '/bin/zsh';
  const term = pty.spawn(shell, ['-lic', 'claude'], {
    name: overrides.TERM,
    cols: 100,
    rows: 28,
    cwd: process.cwd(),
    env,
  });

  term.onData((chunk) => {
    transcript += chunk;
  });

  mark('spawn');
  await sleep(9000);
  mark('before-resize-1');
  term.resize(110, 32);
  await sleep(1200);
  mark('before-resize-2');
  term.resize(95, 24);
  await sleep(1500);
  mark('before-ctrlc');
  term.write('\u0003');
  await sleep(1200);
  mark('before-exit');
  term.write('exit\r');
  await sleep(600);
  term.kill();

  const payload = {
    stats: {
      profile,
      overrides,
      transcriptLength: transcript.length,
      altEnter: (transcript.match(/\u001b\[\?1049h/g) || []).length,
      altExit: (transcript.match(/\u001b\[\?1049l/g) || []).length,
      clearHome: (transcript.match(/\u001b\[2J\u001b\[H/g) || []).length,
      clearScrollback: (transcript.match(/\u001b\[(?:3J|\?3J)/g) || []).length,
      syncStart: (transcript.match(/\u001b\[\?2026h/g) || []).length,
      syncEnd: (transcript.match(/\u001b\[\?2026l/g) || []).length,
    },
    markers,
    sections: buildSections(),
  };

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  console.log(`wrote ${outputPath}`);
  console.log(JSON.stringify(payload.stats, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
