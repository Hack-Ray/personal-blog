/** Share-intent links for a post: plain URLs, so no network SDK loads on the page. */
export function shareLinks(url: string, title: string): { name: string; href: string }[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return [
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { name: "X", href: `https://x.com/intent/post?url=${u}&text=${t}` },
    { name: "Threads", href: `https://www.threads.com/intent/post?url=${u}&text=${t}` },
    { name: "LINE", href: `https://social-plugins.line.me/lineit/share?url=${u}` },
  ];
}
