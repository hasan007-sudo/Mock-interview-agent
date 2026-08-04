export function ReactCodePreview({ url }: { url: string }) {
  return (
    <iframe
      src={url}
      title="React code output"
      className="size-full border-0 bg-white"
      sandbox="allow-forms allow-modals allow-same-origin allow-scripts"
      referrerPolicy="no-referrer"
    />
  );
}
