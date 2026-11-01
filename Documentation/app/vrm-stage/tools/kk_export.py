"""Headless: simplify the Plana (Koikatsu/KKBP) scene and export a skinned GLB with a few morph targets."""
import bpy, os, sys

D = r'C:\Users\admin\AppData\Local\Temp\claude\D--Projects-Claude-vtuber-assistant\5bdb6759-e7e5-4dc8-93c4-6950c5c7d765\scratchpad'
TEX = D + r'\plana\Plana\Textures'
OUT = D + r'\plana_raw.glb'
KEEP = ['Body', 'n_bot_a 25290', 'n_top_a 25060', 'o_panst_00_a 25650', 'o_shoes_roafer01 25880', 'o_shorts_a 25460',
        'Plana_B_hair2 16750', 'Plana_F_hair 16710', 'Plana_hair_acc 17740', 'Plana_halo 18730', 'plana_ribbon 20420']
KEYS = ['KK Eyes_default_cl', 'KK Eyes_smile_cl', 'KK Eyes_smile_op', 'KK Eyes_wink_left_op', 'KK Eyes_wink_right_op', 'KK Eyes_angry_op',
        'KK Eyes_sad_op', 'KK Eyes_worried_op', 'KK Eyes_shy_op', 'KK Eyebrows_angry_op', 'KK Eyebrows_worried_op', 'KK Eyebrows_shocked_op',
        'KK Mouth_smile_op', 'KK Mouth_happy_moderate_op', 'KK Mouth_angry_op', 'KK Mouth_lonely_op', 'KK Mouth_shocked_op',
        'KK Mouth_a_big_op', 'KK Mouth_i_big_op', 'KK Mouth_u_big_op', 'KK Mouth_e_big_op', 'KK Mouth_o_big_op']

rig = bpy.data.objects['RIG-Armature']
rig.data.pose_position = 'REST'
bpy.ops.object.select_all(action='DESELECT')

# drop everything we do not ship
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name not in KEEP:
        bpy.data.objects.remove(o, do_unlink=True)

def main_image(nt, depth=0):
    for n in nt.nodes:
        if n.type == 'TEX_IMAGE' and n.image and 'light' in n.image.name:
            return n.image.name
    for n in nt.nodes:
        if n.type == 'GROUP' and n.node_tree and depth < 4:
            r = main_image(n.node_tree, depth + 1)
            if r:
                return r
    return None

for o in [bpy.data.objects[n] for n in KEEP]:
    # drop modifiers other than the armature (outline solidify, uv warps, data transfer)
    for m in list(o.modifiers):
        if m.type != 'ARMATURE':
            o.modifiers.remove(m)
    # keep only the morph targets we map to expressions
    sk = o.data.shape_keys
    if sk:
        for kb in list(sk.key_blocks)[1:]:
            if kb.name not in KEYS:
                o.shape_key_remove(kb)
    # simple materials: the "light" texture of each KK material, nothing else
    for i, slot in enumerate(o.material_slots):
        m = slot.material
        if not m or 'Outline' in m.name:
            continue
        img = main_image(m.node_tree) if m.use_nodes else None
        if not img:
            continue
        nm = bpy.data.materials.new('P_' + m.name)
        nm.use_nodes = True
        nt = nm.node_tree
        bsdf = nt.nodes['Principled BSDF']
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(os.path.join(TEX, img), check_existing=True)
        if max(tex.image.size) > 2048:  # keep the file small: 4k textures are wasted on a desktop pet
            tex.image.scale(2048, 2048)
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        bsdf.inputs['Roughness'].default_value = 0.9
        bsdf.inputs['Metallic'].default_value = 0.0
        slot.material = nm
    # slots that still point at outline materials only hold faces of the solidify shell: remove unused ones
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    for i in reversed(range(len(o.material_slots))):
        mm = o.material_slots[i].material
        if mm is None or 'Outline' in mm.name:
            o.active_material_index = i
            bpy.ops.object.material_slot_remove()
    o.select_set(False)

for o in [bpy.data.objects[n] for n in KEEP] + [rig]:
    o.hide_set(False)
    o.hide_viewport = False
    o.select_set(True)
bpy.context.view_layer.objects.active = rig

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_def_bones=True,
                          export_morph=True, export_morph_normal=False, export_skins=True, export_animations=False,
                          export_apply=False, export_cameras=False, export_lights=False, export_yup=True)
print("EXPORTED", OUT, os.path.getsize(OUT))
