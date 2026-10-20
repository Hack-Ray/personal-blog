import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>找不到頁面</h1>
      <p>
        <Link href="/">回到首頁</Link>
      </p>
    </>
  );
}
