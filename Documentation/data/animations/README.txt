VRMA clips (VRM Animation, glTF) used by the desktop overlay (src/overlay.js).

Sources and licences
- Kiu-Q/hikari-archive (MIT, see LICENSE-hikari-archive.txt): hang, hanging, idle_look, lay, sit, sit_down, sit_up, walk_left, walk_right, wave_fast.
- yv-was-taken/desktop-waifu (repo MIT; the motions look like Mixamo conversions, so check Mixamo's terms before redistributing): arm_stretch (Arm Stretching), joyful_jump (Joyful Jump), head_shake (Stroke Shaking Head), idle_dwarf (Dwarf Idle), spin (Spinning), cross_jumps (Cross Jumps).
- ruslanmv/3D-Avatar-Chatbot, addons/vrma-dance (Apache-2.0, same Mixamo caveat): dance_rumba, dance_march (marachinostep), dance_dab, dance_soul_spin (northern soul spin), dance_silly (sillyDancing).
Keep this repository private unless you have checked those terms.

Used by the overlay: hang, sit_down, sit, sit_up, idle_look, wave_fast, joyful_jump, head_shake, idle_dwarf, spin, cross_jumps, arm_stretch and the five dance_* clips (hip translation is dropped for dances because their hip heights sink her below the window).
Not used: lay and hanging (they stretch wider than her 520 px window and need a side camera), walk_left and walk_right (they strafe facing the camera; walking is procedural).

Rejected after a test on Taila: peek, situps, situp_to_idle, thinking, talking, neutral_idle (off-screen root motion, lying on the floor, or little gain).

More sources seen: DavinciDreams/3dchat, Enigma-EE/Cipher_Stage, shikharkansal-aria/aria-v2 (licence unclear or Git LFS files missing). Convert your own FBX or BVH with tk256ailab/fbx2vrma-converter or vrm-c/bvh2vrma (both MIT).

Procedural gestures that need no clip (stage.perform in src/stage.js): stretch, yawn, shy, sleepy, earPerk.
