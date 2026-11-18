"""Transient SSH stdio helper. Python standard library only; never installed remotely."""
import base64
import errno
import json
import os
import shutil
import stat
import sys
import tempfile

MAX_FILE = 16 * 1024 * 1024


class Conflict(Exception):
    pass


def revision(s):
    # Nanoseconds and inode numbers may exceed JavaScript's integer precision.
    return [str(s.st_dev), str(s.st_ino), str(s.st_size), str(s.st_mtime_ns)]


def info(path):
    link = os.path.islink(path)
    s = os.stat(path)
    kind = 2 if stat.S_ISDIR(s.st_mode) else 1 if stat.S_ISREG(s.st_mode) else 0
    return {"type": kind | (64 if link else 0), "ctime": s.st_ctime * 1000,
            "mtime": s.st_mtime * 1000, "size": s.st_size, "revision": revision(s)}


def dispatch(op, a):
    p = a.get("path")
    if p is not None and (not isinstance(p, str) or not os.path.isabs(p) or "\0" in p):
        raise ValueError("An absolute remote path is required")
    if op == "home":
        return os.path.expanduser("~")
    if op == "stat":
        return info(p)
    if op == "list":
        rows = []
        with os.scandir(p) as entries:
            for e in entries:
                try:
                    rows.append([e.name, info(e.path)["type"]])
                except FileNotFoundError:
                    if e.is_symlink():
                        rows.append([e.name, 64])
        return rows
    if op == "read":
        if not stat.S_ISREG(os.stat(p).st_mode):
            raise ValueError("Only regular files can be opened")
        with open(p, "rb") as f:
            before = os.fstat(f.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise ValueError("Only regular files can be opened")
            data = f.read(MAX_FILE + 1)
            after = os.fstat(f.fileno())
        if len(data) > MAX_FILE:
            raise ValueError("This prototype supports files up to 16 MiB")
        if revision(before) != revision(after):
            raise Conflict("Remote file changed while being read; reopen it")
        return {"data": base64.b64encode(data).decode("ascii"), "revision": revision(after)}
    if op == "write":
        # Follow an existing symlink, preserving the link itself.
        target = os.path.realpath(p)
        exists = os.path.exists(target)
        if exists and not a.get("overwrite"):
            raise FileExistsError(errno.EEXIST, "File exists", p)
        if not exists and not a.get("create"):
            raise FileNotFoundError(errno.ENOENT, "File does not exist", p)
        data = base64.b64decode(a["data"], validate=True)
        if len(data) > MAX_FILE:
            raise ValueError("This prototype supports files up to 16 MiB")
        if exists and a.get("expected") is not None and revision(os.stat(target)) != a["expected"]:
            raise Conflict("Remote file was changed outside VS Code. Reopen it before saving")
        if not exists:
            with open(target, "xb") as f:
                f.write(data)
        else:
            current = os.stat(target)
            if not stat.S_ISREG(current.st_mode):
                raise ValueError("Only regular files can be saved")
            # Avoid replacing hard-linked files and breaking their relationship.
            if current.st_nlink > 1:
                raise ValueError("Saving hard-linked files is not supported by this prototype")
            fd, temp = tempfile.mkstemp(prefix=".ssh-stdio-", dir=os.path.dirname(target))
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                    os.fchmod(f.fileno(), stat.S_IMODE(current.st_mode))
                    f.flush()
                    os.fsync(f.fileno())
                if revision(os.stat(target)) != revision(current):
                    raise Conflict("Remote file changed during save; reopen it")
                os.replace(temp, target)
            finally:
                if os.path.exists(temp):
                    os.unlink(temp)
        return info(p)
    if op == "mkdir":
        os.mkdir(p)
        return None
    if op == "delete":
        if os.path.islink(p) or not os.path.isdir(p):
            os.unlink(p)
        elif a.get("recursive"):
            if os.path.realpath(p) in ("/", os.path.expanduser("~")):
                raise PermissionError("Refusing to recursively delete root or home")
            shutil.rmtree(p)
        else:
            os.rmdir(p)
        return None
    if op == "rename":
        dest = a["destination"]
        if not os.path.isabs(dest) or "\0" in dest:
            raise ValueError("An absolute destination is required")
        if os.path.lexists(dest) and not a.get("overwrite"):
            raise FileExistsError(errno.EEXIST, "Destination exists", dest)
        os.rename(p, dest)
        return None
    raise ValueError("Unknown operation")


print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        result = dispatch(request["op"], request.get("args", {}))
        response = {"id": request["id"], "result": result}
    except Exception as e:
        response = {"id": request.get("id") if isinstance(request, dict) else None,
                    "error": {"code": getattr(e, "errno", None),
                              "kind": type(e).__name__, "message": str(e)}}
    print(json.dumps(response, ensure_ascii=True), flush=True)
