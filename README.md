# SSH Stdio for VS Code

**Edit remote files in VS Code over SSH — no port or socket forwarding required!**

SSH Stdio lets you browse, edit, and save remote files using an ordinary SSH session. It is built for environments where SSH login works, but TCP and Unix socket forwarding are unavailable or disabled.

No relay service, extra listening port, or permanent remote agent installation is required.

> **Experimental:** This extension currently provides remote file editing and an SSH terminal. It does not provide the full remote development environment of Microsoft's Remote - SSH extension.

## Why SSH Stdio?

Being able to run `ssh my-server` does not always mean you can use VS Code Remote - SSH. The official extension uses SSH forwarding to communicate with its remote server, including when configured to use a Unix socket.

SSH Stdio takes a different approach: it sends file operations through the standard input and output of an SSH session. If ordinary SSH command execution is permitted, file editing can work without forwarding.

## Features

- Browse remote folders in VS Code Explorer.
- Open, edit, and save text or binary files, up to 16 MiB each.
- Create files and folders, rename items, and delete them.
- Open an SSH terminal in the selected remote workspace folder.
- Use existing SSH host aliases, keys, and SSH agent authentication.
- Reject saves when a previously read file revision has changed remotely.
- Run a temporary Python helper using only the Python standard library.

## Requirements

- VS Code 1.90 or later.
- A local macOS or Linux machine with `/usr/bin/ssh`.
- Python 3 on the remote machine, available as `python3`.
- Working noninteractive SSH authentication, such as a key or SSH agent.

The initial prototype was tested from macOS against a Linux host running Python 3.9. Windows clients are not currently supported.

## Installation

Install the packaged `.vsix` file in VS Code:

1. Open the Extensions view.
2. Click the **…** menu and select **Install from VSIX…**.
3. Select `ssh-stdio-0.1.0.vsix`.

Alternatively:

```bash
code --install-extension ssh-stdio-0.1.0.vsix
```

## Usage

### Open a remote folder

1. Open a new, empty local VS Code window.
2. Open the Command Palette with `Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Linux.
3. Run **SSH Stdio: Open Remote Folder**.
4. Enter a host alias from your SSH configuration, such as `my-server`.
5. Enter an absolute remote folder path, or accept the default home directory.

The folder appears in Explorer. Open files as usual and save with `Cmd+S` or `Ctrl+S`. Changes are written directly to the remote machine.

### Open a remote terminal

Run **SSH Stdio: Open Remote Terminal** from the Command Palette.

This opens an ordinary SSH shell in the selected remote workspace folder. Use it to run commands, execute scripts, or work with Git on the remote machine.

### Disconnect

Run **SSH Stdio: Disconnect** to close file connections. SSH terminals are separate; close them or type `exit` to end their sessions.

## How it works

```text
VS Code Explorer and editor
           |
     FileSystemProvider
           |
  JSON over SSH stdin/stdout
           |
  Temporary Python helper
           |
     Remote filesystem
```

The extension starts a Python helper through SSH and exchanges JSON requests and responses over that session. File contents are Base64 encoded for transport.

The helper runs for the lifetime of the connection. It does not listen on a network port. SSH provides encryption and authentication, and host key checking remains enabled. The extension explicitly clears SSH forwarding settings for its connections.

## Current limitations

- **Virtual workspace:** Full remote debugging, remote language servers, remote extension hosting, and built-in remote Git integration are not provided. Other extensions may have limited functionality.
- **Manual refresh:** External file changes are not watched automatically. Refresh Explorer and reopen files to see them.
- **File size:** Individual files are limited to 16 MiB. Overwriting hard-linked files is not supported.
- **Permanent deletion:** Deleted files do not go to a remote trash folder.
- **File metadata:** Saving an existing regular file replaces it in the same directory and preserves Unix mode bits. Ownership, ACLs, and extended attributes are not preserved. Avoid files that require special metadata.
- **Connection loss:** Operations are not automatically retried. If a connection drops during a save, check the remote file before retrying.
