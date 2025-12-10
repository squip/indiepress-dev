import { useEffect } from 'react'
import MdEditor from 'react-markdown-editor-lite'
import 'react-markdown-editor-lite/lib/index.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { remarkNostrLinks, nostrSanitizeSchema } from '@/lib/markdown'

export default function ArticleMarkdownEditor({
  value,
  onChange,
  showPreview
}: {
  value: string
  onChange: (next: string) => void
  showPreview: boolean
}) {
  useEffect(() => {
    // ensure the markdown editor picks up the latest value when toggling
  }, [showPreview])

  if (showPreview) {
    return (
      <div className="prose prose-base dark:prose-invert max-w-none border rounded-lg p-4 bg-background">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkNostrLinks]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, nostrSanitizeSchema]]}
        >
          {value || ''}
        </ReactMarkdown>
      </div>
    )
  }

  return (
    <MdEditor
      value={value}
      style={{ height: '420px' }}
      onChange={({ text }) => onChange(text)}
      renderHTML={(text) => (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkNostrLinks]}
          rehypePlugins={[rehypeRaw, [rehypeSanitize, nostrSanitizeSchema]]}
        >
          {text}
        </ReactMarkdown>
      )}
      view={{ html: false, md: true, menu: true }}
    />
  )
}
