const res = await fetch("https://api.github.com/search/code?q=LZ5+decompress+sff+language:java+language:javascript+language:c+language:python", {
  headers: { "User-Agent": "agent" }
});
const data = await res.json();
if (data.items) {
  for (const item of data.items.slice(0, 2)) {
    console.log(item.html_url);
    const rawRes = await fetch(item.html_url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/"));
    const text = await rawRes.text();
    console.log("----");
    const lines = text.split("\n");
    const idx = lines.findIndex(l => l.toLowerCase().includes("lz5"));
    if (idx >= 0) {
      console.log(lines.slice(Math.max(0, idx - 10), idx + 100).join("\n"));
    }
  }
} else {
  console.log(data);
}
