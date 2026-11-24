import fs from 'node:fs';
const SKINS = {
  dragons: { name: 'Dragons', kit: 'dragons-lair-dark-dragon-782570',
    pieces: { pawn: 'Red Fire Dragonling', knight: 'Dragon Slayer', bishop: 'Dragon Keeper', rook: 'Crystal Dragon', queen: 'Green Gas Dragon', king: 'Purple Flame Dragon' } },
  ww2: { name: 'World War II', kit: 'world-war-ii-ba2289',
    pieces: { pawn: 'Infantry Rifleman', knight: 'Scout Jeep', bishop: 'Field Medic', rook: 'Medium Tank', queen: 'Single-Engine Fighter', king: 'Squad Officer' } },
};
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r; };
const out = {};
for (const [key, s] of Object.entries(SKINS)) {
  const list = (await (await get(`https://polyfork.dev/api/assets?kit=${s.kit}&fields=compact&per_page=100`)).json()).assets;
  out[key] = { name: s.name, pieces: {} };
  for (const [role, title] of Object.entries(s.pieces)) {
    const a = list.find((x) => x.title === title);
    if (!a) throw new Error(`missing ${title} in ${s.kit}`);
    const d = await (await get(`https://polyfork.dev/api/assets/${a.id}`)).json();
    const det = d.asset || d;
    const glb = Buffer.from(await (await get(`https://polyfork.dev/cdn/${a.id}.glb`)).arrayBuffer());
    fs.writeFileSync(`assets/${a.id}.glb`, glb);
    out[key].pieces[role] = { id: a.id, title, cls: a.class, skeleton: !!a.has_skeleton, clips: (det.clips || []).map((c) => c.name), credit: det.credit, bytes: glb.length };
    console.log(key, role, a.id, a.class, 'skel=' + a.has_skeleton, 'clips=' + (det.clips || []).map((c) => c.name).join('/'), glb.length);
  }
}
fs.writeFileSync('skins.json', JSON.stringify(out, null, 1));
