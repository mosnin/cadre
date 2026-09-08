"""Root-owned, per-screen human input generations and observation fences."""
import fcntl
import hashlib
from pathlib import Path
import screens

PUBLIC_STATE = Path("/run/cadre-input")

def public_path(key):
    PUBLIC_STATE.mkdir(mode=0o755,parents=True,exist_ok=True)
    PUBLIC_STATE.chmod(0o755)
    return PUBLIC_STATE / key


def current(key):
    try: return int((screens.STATE / (key+'.input')).read_text())
    except FileNotFoundError: return 0


def advance(key):
    with open(screens.STATE / (key+'.input.lock'),'a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        value=current(key)+1
        path=screens.STATE / (key+'.input')
        temporary=path.with_suffix('.input.tmp')
        temporary.write_text(str(value));temporary.chmod(0o600);temporary.replace(path)
        visible=public_path(key)
        pending=visible.with_suffix(".tmp")
        pending.write_text(str(value));pending.chmod(0o444);pending.replace(visible)
        return value


def observation_path(key,lease):
    return screens.STATE / (key+'.'+hashlib.sha256(lease.encode()).hexdigest()+'.observation')


def observed(key,lease,epoch):
    if not lease:return
    path=observation_path(key,lease)
    path.write_text(str(epoch));path.chmod(0o600)


def require_fresh(key,lease):
    if not lease:return
    now=current(key)
    try: seen=int(observation_path(key,lease).read_text())
    except FileNotFoundError: seen=0
    if seen != now:
        raise ValueError('Human input changed the computer. Take a fresh computer observation before acting.')
