"""Build sim/mocap-clips.json: locomotion cycles from the CMU motion-capture database, retargeted to the soldier.

Source: the CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by Bruce Hahne
(cgspeed), mirrored at github.com/meshula/cmu-mocap. "CMU places no restrictions on the use of the original
dataset, and I (Bruce) place no additional restrictions on the use of this particular BVH conversion."

What it does, per clip:
  1. parse the BVH and run forward kinematics (Y up, character's left = +X, forward = +Z);
  2. cancel the slowly varying heading (a ~1 s moving average of the hips' facing) so the clip is in place
     but keeps the pelvis's natural yaw swing;
  3. retarget to the soldier's joints (whose rest rotations are all identity):
       - thighs and shins by bone direction plus the knee's bend axis (the CMU rest pose splays the legs
         about 20 degrees, so copying rotations would bow the legs),
       - hips, spine, chest, neck, head, feet and toes by rotation from the (upright, flat-footed) rest pose;
  4. cut one gait cycle from left heel-strike to the next, so every clip shares the same phase,
     and resample it to N poses; also record the cycle's travel (metres, soldier scale), the hips' bob and
     how high the lowest foot is off the floor ("air", for grounding the pelvis on the page).
Strafe-left is the mirror of strafe-right.

Usage:  python3 tools/build_mocap.py      (from the repo root; BVH files are cached in ./mocap-cache)
"""
import json
import math
import os
import urllib.request

import numpy as np

MIRROR = "https://raw.githubusercontent.com/meshula/cmu-mocap/master/data/{s:03d}/{c}.bvh"
CACHE = "mocap-cache"
N = 32                       # poses per cycle
SOLDIER_LEG = 0.84           # hip-to-ankle length of the soldier model, metres
# clip name -> (CMU take, which way the chosen gait cycle should travel; 'idle' is a quiet stretch of standing)
CLIPS = {
    "walk":     ("08_01", "fwd"),
    "creep":    ("77_29", "fwd"),
    "jog":      ("16_35", "fwd"),
    "run":      ("09_01", "fwd"),
    "back":     ("76_09", "back"),
    "strafeR":  ("69_42", "side"),
    "idle":     ("82_08", "idle"),
}
SOLDIER = ["Hips", "Spine", "Chest", "Neck", "Head", "ThighL", "ShinL", "FootL", "ToeL", "ThighR", "ShinR", "FootR", "ToeR"]


# ---------------------------------------------------------------- math
def rot_axis(axis, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    if axis == "X": return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == "Y": return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def mat_to_quat(m):
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1) * 2; w = 0.25 * s; x = (m[2, 1] - m[1, 2]) / s; y = (m[0, 2] - m[2, 0]) / s; z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; w = (m[2, 1] - m[1, 2]) / s; x = 0.25 * s; y = (m[0, 1] + m[1, 0]) / s; z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; w = (m[0, 2] - m[2, 0]) / s; x = (m[0, 1] + m[1, 0]) / s; y = 0.25 * s; z = (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; w = (m[1, 0] - m[0, 1]) / s; x = (m[0, 2] + m[2, 0]) / s; y = (m[1, 2] + m[2, 1]) / s; z = 0.25 * s
    q = np.array([x, y, z, w]); return q / np.linalg.norm(q)


def basis(yv, xv):
    """rotation whose +Y is yv and whose +X is xv made orthogonal to it"""
    y = yv / np.linalg.norm(yv); x = xv - y * np.dot(xv, y); x /= np.linalg.norm(x); z = np.cross(x, y)
    return np.stack([x, y, z], axis=1)


def slerp(a, b, t):
    d = np.dot(a, b)
    if d < 0: b, d = -b, -d
    if d > 0.9995: q = a + (b - a) * t; return q / np.linalg.norm(q)
    th = math.acos(d); return (math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th)


# ---------------------------------------------------------------- BVH
def parse_bvh(text):
    tok = text.split(); i = 0; joints = []; stack = []
    while tok[i] != "MOTION":
        t = tok[i]
        if t in ("ROOT", "JOINT"):
            j = {"name": tok[i + 1], "parent": stack[-1] if stack else -1, "chan": [], "end": None}; joints.append(j); i += 2
        elif t == "End":
            i += 2; assert tok[i] == "{"; joints[stack[-1]]["end"] = [float(v) for v in tok[i + 2:i + 5]]; i += 6; continue
        elif t == "{":
            stack.append(len(joints) - 1); i += 1
        elif t == "}":
            stack.pop(); i += 1
        elif t == "OFFSET":
            joints[stack[-1]]["off"] = np.array([float(v) for v in tok[i + 1:i + 4]]); i += 4
        elif t == "CHANNELS":
            n = int(tok[i + 1]); joints[stack[-1]]["chan"] = tok[i + 2:i + 2 + n]; i += 2 + n
        else:
            i += 1
    i += 1; nf = int(tok[i + 1]); ft = float(tok[i + 4]); i += 5
    data = np.array(tok[i:], dtype=float).reshape(nf, -1)
    return joints, data, ft


def fk(joints, data):
    """world rotation matrices and positions per frame per joint"""
    nf, nj = len(data), len(joints)
    R = np.zeros((nf, nj, 3, 3)); P = np.zeros((nf, nj, 3))
    for f in range(nf):
        c = 0
        for k, j in enumerate(joints):
            loc = np.eye(3); pos = j["off"].copy()
            for ch in j["chan"]:
                v = data[f, c]; c += 1
                if ch.endswith("position"): pos["XYZ".index(ch[0])] = v
                else: loc = loc @ rot_axis(ch[0], v)
            if j["parent"] < 0: R[f, k] = loc; P[f, k] = pos
            else:
                p = j["parent"]; R[f, k] = R[f, p] @ loc; P[f, k] = P[f, p] + R[f, p] @ pos
    return R, P


def get(c):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, c + ".bvh")
    if not os.path.exists(path):
        urllib.request.urlretrieve(MIRROR.format(s=int(c.split("_")[0]), c=c), path)
    return open(path).read()


# ---------------------------------------------------------------- retarget one take
def retarget(take):
    joints, data, ft = parse_bvh(get(take))
    idx = {j["name"]: k for k, j in enumerate(joints)}
    R, P = fk(joints, data)
    nf = len(data)
    mleg = np.linalg.norm(joints[idx["LeftLeg"]]["off"]) + np.linalg.norm(joints[idx["LeftFoot"]]["off"])
    scale = SOLDIER_LEG / mleg
    # heading: hips' forward (+Z) on the ground plane, unwrapped and averaged over ~1 s
    fwd = R[:, idx["Hips"]] @ np.array([0, 0, 1.0])
    yaw = np.unwrap(np.arctan2(fwd[:, 0], fwd[:, 2]))
    win = max(1, int(round(0.5 / ft)))
    ker = np.ones(2 * win + 1) / (2 * win + 1)
    yaw_s = np.convolve(np.pad(yaw, win, mode="edge"), ker, mode="valid")
    out = {n: np.zeros((nf, 4)) for n in SOLDIER}
    hipsY = np.zeros(nf); root = np.zeros((nf, 2))
    for f in range(nf):
        H = rot_axis("Y", -math.degrees(yaw_s[f]))          # removes the heading
        Rw = lambda n: H @ R[f, idx[n]]
        Pw = lambda n: H @ P[f, idx[n]]
        W = {}
        W["Hips"] = Rw("Hips")
        W["Spine"] = Rw("Spine"); W["Chest"] = Rw("Spine1"); W["Neck"] = Rw("Neck"); W["Head"] = Rw("Head")
        for s, m in (("L", "Left"), ("R", "Right")):
            hip, knee, ank = Pw(m + "UpLeg"), Pw(m + "Leg"), Pw(m + "Foot")
            # bone axis down the limb; lateral axis from the mocap bone's own +X (the knee hinge)
            W["Thigh" + s] = basis(hip - knee, Rw(m + "UpLeg") @ np.array([1.0, 0, 0]))
            W["Shin" + s] = basis(knee - ank, Rw(m + "Leg") @ np.array([1.0, 0, 0]))
            W["Foot" + s] = Rw(m + "Foot"); W["Toe" + s] = Rw(m + "ToeBase")
        parent = {"Hips": None, "Spine": "Hips", "Chest": "Spine", "Neck": "Chest", "Head": "Neck",
                  "ThighL": "Hips", "ShinL": "ThighL", "FootL": "ShinL", "ToeL": "FootL",
                  "ThighR": "Hips", "ShinR": "ThighR", "FootR": "ShinR", "ToeR": "FootR"}
        for n in SOLDIER:
            loc = W[n] if parent[n] is None else W[parent[n]].T @ W[n]
            out[n][f] = mat_to_quat(loc)
        hipsY[f] = P[f, idx["Hips"]][1] * scale
        root[f] = (H @ P[f, idx["Hips"]])[[0, 2]] * scale
    footY = P[:, idx["LeftFoot"], 1]
    # how far the lowest foot is off the floor (the flight phase of a run); the page grounds the pelvis with it
    low = np.min(P[:, [idx["LeftFoot"], idx["RightFoot"], idx["LeftToeBase"], idx["RightToeBase"]], 1], axis=1) * scale
    air = low - np.percentile(low, 2)
    return dict(out=out, hipsY=hipsY, root=root, yaw=yaw_s, ft=ft, footY=footY, P=P, idx=idx, scale=scale, air=air)


def contacts(footY, ft):
    """frames where the left foot comes down: local minima of ankle height, at least 0.5 s apart"""
    lo = np.percentile(footY, 25)
    c = [f for f in range(2, len(footY) - 2) if footY[f] <= footY[f - 1] and footY[f] < footY[f + 1] and footY[f] < lo + 0.3 * (np.ptp(footY))]
    keep = []
    for f in c:
        if not keep or (f - keep[-1]) * ft > 0.5: keep.append(f)
    return keep


def cycle(rt, which):
    ft = rt["ft"]
    if which == "idle":   # a quiet 3 s of standing, cross-faded into a loop
        sp = np.linalg.norm(np.diff(rt["root"], axis=0), axis=1) / ft
        still = np.where(sp < 0.12)[0]
        a = int(still[0]); b = min(a + int(3.0 / ft), int(still[-1]))
        return a, b, 0.0
    c = contacts(rt["footY"], ft)
    if len(c) < 2: raise SystemExit("no gait cycle found")
    # score every left-to-left cycle by travel in the wanted direction, and by how straight it is
    best, bs = None, -1e9
    for a, b in zip(c, c[1:]):
        dur = (b - a) * ft
        if not 0.6 <= dur <= 1.7: continue
        d = rt["root"][b] - rt["root"][a]
        turn = abs(rt["yaw"][b] - rt["yaw"][a])
        sc = {"fwd": d[1] - abs(d[0]), "back": -d[1] - abs(d[0]), "side": abs(d[0]) - abs(d[1])}[which] - 2.0 * turn
        if sc > bs: bs, best = sc, (a, b, d)
    if best is None: raise SystemExit("no usable gait cycle")
    return best


def resample(rt, a, b, loop_fade=False):
    res = {}
    for n in SOLDIER:
        q = rt["out"][n]; seq = []
        for i in range(N):
            t = a + (b - a) * i / N; f0 = int(math.floor(t)); u = t - f0
            v = slerp(q[f0], q[min(f0 + 1, len(q) - 1)], u)
            if loop_fade:   # blend the last third toward the first pose so the loop closes
                w = max(0, (i / N - 0.66) / 0.34); v = slerp(v, q[a], w * w)
            if seq and np.dot(seq[-1], v) < 0: v = -v
            seq.append(v)
        res[n] = [[round(float(x), 4) for x in v] for v in seq]
    hy = [rt["hipsY"][int(a + (b - a) * i / N)] for i in range(N)]
    mean = float(np.mean(hy))
    air = [round(float(max(0.0, rt["air"][int(a + (b - a) * i / N)])), 4) for i in range(N)]
    return res, [round(float(h - mean), 4) for h in hy], air


def mirror(clip):
    """left/right mirror across the body's YZ plane, shifted half a cycle so phase 0 is again a left heel-strike"""
    out = {}
    for n, seq in clip.items():
        m = n[:-1] + ("R" if n.endswith("L") else "L") if n[-1] in "LR" and n not in ("Hips", "Head", "Neck", "Chest", "Spine") else n
        h = len(seq) // 2
        out[m] = [[q[0], -q[1], -q[2], q[3]] for q in seq[h:] + seq[:h]]
    return out


def main():
    result = {"source": "CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by B. Hahne; no restrictions on use",
              "joints": SOLDIER, "n": N, "clips": {}}
    for name, (take, which) in CLIPS.items():
        rt = retarget(take)
        a, b, d = cycle(rt, which)
        q, hy, air = resample(rt, a, b, loop_fade=(which == "idle"))
        if which == "idle": air = [0.0] * N
        dur = (b - a) * rt["ft"]
        if which == "idle":
            travel = [0.0, 0.0]
        else:
            travel = [round(float(d[0]), 3), round(float(d[1]), 3)]   # x = left, z = forward, metres per cycle
        result["clips"][name] = {"take": take, "dur": round(dur, 3), "travel": travel, "q": q, "hipsY": hy, "air": air}
        print(f"{name:8s} {take}  frames {a}-{b}  {dur:.2f} s  travel x {travel[0]:+.2f} z {travel[1]:+.2f} m")
    # strafing left is the mirror image of strafing right
    sr = result["clips"]["strafeR"]
    if sr["travel"][0] > 0:   # the take actually went left: swap the names
        result["clips"]["strafeL"] = sr; sr = dict(sr, q=mirror(sr["q"]), hipsY=sr["hipsY"][N // 2:] + sr["hipsY"][:N // 2], air=sr["air"][N // 2:] + sr["air"][:N // 2], travel=[-sr["travel"][0], sr["travel"][1]]); result["clips"]["strafeR"] = sr
    else:
        result["clips"]["strafeL"] = dict(sr, q=mirror(sr["q"]), hipsY=sr["hipsY"][N // 2:] + sr["hipsY"][:N // 2], air=sr["air"][N // 2:] + sr["air"][:N // 2], travel=[-sr["travel"][0], sr["travel"][1]])
    with open(os.path.join("sim", "mocap-clips.json"), "w") as f:
        json.dump(result, f, separators=(",", ":"))
    print("wrote sim/mocap-clips.json", os.path.getsize("sim/mocap-clips.json"), "bytes")


if __name__ == "__main__":
    main()
