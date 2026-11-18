'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function validateHost(host) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(host)) {
    throw new Error('Enter an SSH host alias such as my-server (from ~/.ssh/config).');
  }
  return host;
}
function quote(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

class Transport {
  constructor(host, log = () => {}) {
    this.host = validateHost(host);
    this.log = log;
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    const encoded = fs.readFileSync(path.join(__dirname, 'remote.py')).toString('base64');
    const command = 'python3 -u -c ' + quote(`import base64; exec(compile(base64.b64decode('${encoded}'), '<ssh-stdio>', 'exec'))`);
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Prevent an unobserved rejection if the process exits while starting up.
    this.ready.catch(() => {});
    this.proc = spawn('/usr/bin/ssh', [
      '-T', '-o', 'BatchMode=yes', '-o', 'UpdateHostKeys=no',
      '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', host, command
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.stderr = '';
    this.proc.stderr.on('data', data => {
      this.stderr = (this.stderr + data.toString()).slice(-3000);
      this.log(data.toString().trim());
    });
    this.lines = readline.createInterface({ input: this.proc.stdout });
    this.lines.on('line', line => {
      let msg;
      try { msg = JSON.parse(line); } catch {
        this.fail(new Error('Unexpected SSH output; the remote shell must keep stdout clean.'));
        return;
      }
      if (msg.ready) { clearTimeout(this.startTimer); this.resolveReady(); return; }
      const item = this.pending.get(msg.id);
      if (!item) return;
      this.pending.delete(msg.id);
      clearTimeout(item.timer);
      if (msg.error) {
        const e = new Error(msg.error.message);
        Object.assign(e, msg.error);
        item.reject(e);
      } else item.resolve(msg.result);
    });
    this.proc.on('error', e => this.fail(e));
    this.proc.stdin.on('error', e => this.fail(e));
    this.proc.on('exit', (code, signal) => this.fail(new Error(
      `SSH connection closed (${signal || code}). ${this.stderr.trim()}`
    )));
    this.startTimer = setTimeout(() => this.fail(new Error('SSH startup timed out. Check SSH access and Python 3.')), 20000);
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.startTimer);
    this.rejectReady(error);
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    this.proc.kill();
    this.log(error.message);
  }
  async request(op, args = {}) {
    await this.ready;
    if (this.closed) throw new Error('SSH disconnected. Run SSH Stdio: Open Remote Folder to reconnect.');
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(
        'SSH request timed out. Its outcome may be unknown; check the remote file before retrying a change.'
      )), 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, op, args }) + '\n', error => {
        if (error) this.fail(error);
      });
    });
  }
  dispose() { this.fail(new Error('SSH disconnected.')); }
}
module.exports = { Transport, validateHost, quote };
