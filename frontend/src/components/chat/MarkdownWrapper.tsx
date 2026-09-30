export const MarkdownWrapper = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div dir="auto" className={className} style={{ unicodeBidi: 'plaintext' }}>
      {children}
    </div>
  );