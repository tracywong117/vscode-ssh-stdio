'use strict';
const vscode = require('vscode');
const { Transport, validateHost, quote } = require('./transport');

function activate(context) {
  const output = vscode.window.createOutputChannel('SSH Stdio');
  const connections = new Map();
  const revisions = new Map();
  const events = new vscode.EventEmitter();
  function connection(host) {
    validateHost(host);
    if (!connections.has(host) || connections.get(host).closed) {
      connections.set(host, new Transport(host, line => output.appendLine(`[${host}] ${line}`)));
    }
    return connections.get(host);
  }
  async function call(uri, op, extra = {}) {
    try { return await connection(uri.authority).request(op, { path: uri.path, ...extra }); }
    catch (e) {
      if (e.code === 2) throw vscode.FileSystemError.FileNotFound(uri);
      if (e.code === 17) throw vscode.FileSystemError.FileExists(uri);
      if (e.code === 13 || e.code === 1) throw vscode.FileSystemError.NoPermissions(e.message);
      if (e.code === 21) throw vscode.FileSystemError.FileIsADirectory(uri);
      if (e.code === 20) throw vscode.FileSystemError.FileNotADirectory(uri);
      throw vscode.FileSystemError.Unavailable(e.message);
    }
  }
  function change(uri, type) { events.fire([{ uri, type }]); }
  const provider = {
    onDidChangeFile: events.event,
    watch() { return new vscode.Disposable(() => {}); },
    stat(uri) { return call(uri, 'stat'); },
    readDirectory(uri) { return call(uri, 'list'); },
    async readFile(uri) {
      const result = await call(uri, 'read');
      revisions.set(uri.toString(), result.revision);
      return Buffer.from(result.data, 'base64');
    },
    async writeFile(uri, content, options) {
      if (content.byteLength > 16 * 1024 * 1024) throw vscode.FileSystemError.Unavailable('Maximum file size: 16 MiB.');
      const result = await call(uri, 'write', {
        ...options, data: Buffer.from(content).toString('base64'),
        expected: revisions.get(uri.toString())
      });
      revisions.set(uri.toString(), result.revision);
      change(uri, vscode.FileChangeType.Changed);
    },
    async createDirectory(uri) { await call(uri, 'mkdir'); change(uri, vscode.FileChangeType.Created); },
    async delete(uri, options) {
      await call(uri, 'delete', options);
      revisions.delete(uri.toString());
      change(uri, vscode.FileChangeType.Deleted);
    },
    async rename(oldUri, newUri, options) {
      if (oldUri.authority !== newUri.authority) throw vscode.FileSystemError.Unavailable('Cannot move across SSH hosts.');
      await call(oldUri, 'rename', { destination: newUri.path, ...options });
      revisions.delete(oldUri.toString()); revisions.delete(newUri.toString());
      change(oldUri, vscode.FileChangeType.Deleted); change(newUri, vscode.FileChangeType.Created);
    }
  };
  context.subscriptions.push(output, events,
    vscode.workspace.registerFileSystemProvider('ssh-stdio', provider, { isCaseSensitive: true }),
    { dispose() { for (const c of connections.values()) c.dispose(); } }
  );
  context.subscriptions.push(vscode.commands.registerCommand('sshStdio.openFolder', async () => {
    try {
      const host = await vscode.window.showInputBox({ prompt: 'SSH host alias from ~/.ssh/config', placeHolder: 'my-server',
        validateInput(value) { try { validateHost(value); } catch (e) { return e.message; } } });
      if (!host) return;
      const home = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
        title: `Connecting to ${host} over SSH` }, () => connection(host).request('home'));
      let folder = await vscode.window.showInputBox({ prompt: 'Remote folder (absolute path)', value: home,
        validateInput(value) { return value.startsWith('/') ? null : 'Enter an absolute path starting with /'; } });
      if (!folder) return;
      folder = folder.replace(/\/+$/, '') || '/';
      const uri = vscode.Uri.from({ scheme: 'ssh-stdio', authority: host, path: folder });
      const st = await call(uri, 'stat');
      if (!(st.type & vscode.FileType.Directory)) throw new Error('Choose a directory.');
      const index = (vscode.workspace.workspaceFolders || []).length;
      if (!vscode.workspace.updateWorkspaceFolders(index, 0, { uri, name: `${host}: ${folder}` })) {
        throw new Error('VS Code could not add the remote folder.');
      }
    } catch (e) { vscode.window.showErrorMessage(`SSH Stdio: ${e.message}`); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('sshStdio.terminal', async () => {
    const folders = (vscode.workspace.workspaceFolders || []).filter(f => f.uri.scheme === 'ssh-stdio');
    if (!folders.length) { vscode.window.showInformationMessage('Open a folder with SSH Stdio first.'); return; }
    const selected = folders.length === 1 ? { folder: folders[0] } : await vscode.window.showQuickPick(
      folders.map(folder => ({ label: folder.name, folder })), { placeHolder: 'Choose remote folder' });
    if (!selected) return;
    const uri = selected.folder.uri;
    validateHost(uri.authority);
    const terminal = vscode.window.createTerminal({ name: `SSH: ${uri.authority}`, shellPath: '/usr/bin/ssh',
      shellArgs: ['-t', '-o', 'ClearAllForwardings=yes', '-o', 'UpdateHostKeys=no', uri.authority,
        `cd ${quote(uri.path)} && exec "\${SHELL:-/bin/sh}" -l`] });
    terminal.show();
  }));
  context.subscriptions.push(vscode.commands.registerCommand('sshStdio.disconnect', () => {
    for (const c of connections.values()) c.dispose();
    connections.clear();
    vscode.window.showInformationMessage('SSH Stdio file connections closed. Close SSH terminals separately.');
  }));
}
module.exports = { activate };
