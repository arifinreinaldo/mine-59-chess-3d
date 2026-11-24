import fs from 'node:fs';
const IDS = [
 // dragons
 'coiled-dragon-pillar-7d526a','ancient-dragon-skull-7be378','gold-hoard-mound-d0a2be','flame-brazier-bbf74a','dragonfire-brazier-6bc2ce',
 'lair-stalagmite-7d4d95','lair-crystal-column-877d1a','giant-dragon-rib-0e42d9','ember-dragon-egg-0700c7','geode-dragon-egg-89141e',
 'miasma-dragon-egg-4b66e0','skull-and-bone-scatter-3dea4c','obsidian-fang-rock-67e326','dragon-skeleton-88de43','bone-warning-totem-56cf4a','overflowing-treasure-chest-3d6ee0',
 // ww2
 'sandbag-wall-section-7075ee','czech-hedgehog-d77ae5','barbed-wire-fence-section-a01906','anti-aircraft-searchlight-ba3f07','radar-aerial-mast-f88914',
 'barrage-balloon-2edc43','sentry-box-fc915e','concrete-pillbox-ea855a','ammunition-crate-a5c550','shelled-townhouse-2483d1','nissen-hut-dafb56',
 'blackout-lamp-post-3af3ca','field-hospital-marquee-8cf79b','splintered-roadside-poplar-5859d8','minefield-warning-sign-296d9e','field-grave-marker-15380b',
];
const out = {};
for (const id of IDS) {
  const d = await (await fetch(`https://polyfork.dev/api/assets/${id}`)).json(); const a = d.asset || d;
  const r = await fetch(`https://polyfork.dev/cdn/${id}.glb`); if (!r.ok) throw new Error(id + ' ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(`assets/${id}.glb`, buf);
  out[id] = { title: a.title, credit: a.credit, bytes: buf.length, size: a.size_m };
  console.log(id.padEnd(36), String(buf.length).padStart(8), a.title);
}
fs.writeFileSync('props.json', JSON.stringify(out, null, 1));
