(async () => {
  const res = await fetch("https://api.github.com/repos/ikemen-engine/Ikemen-GO/git/trees/master?recursive=1", {
    headers: { "User-Agent": "agent" }
  });
  if (!res.ok) {
    console.log("Failed:", await res.text());
    return;
  }
  const tree = (await res.json()).tree;
  const sffFile = tree.find(t => t.path.toLowerCase().includes('lz5') || t.path.toLowerCase().includes('sff'));
  console.log("Matched files:");
  for (const t of tree) {
    if (t.path.toLowerCase().includes('lz5') || t.path.toLowerCase().includes('sff')) {
      console.log(t.path);
    }
  }
})();
