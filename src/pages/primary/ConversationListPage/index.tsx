import HideUntrustedContentButton from '@/components/HideUntrustedContentButton'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { MessageSquare } from 'lucide-react'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { MessengerProvider } from '@/providers/MessengerProvider'
import { DMConversationsView } from '@/components/DMConversations'
import { useNostr } from '@/providers/NostrProvider'

const ConversationListPage = forwardRef((_, ref) => {
  const { pubkey } = useNostr()

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="conversations"
      titlebar={<ConversationListPageTitlebar />}
      displayScrollToTopButton
    >
      <MessengerProvider>
        <DMConversationsView myPubkey={pubkey} />
      </MessengerProvider>
    </PrimaryPageLayout>
  )
})
ConversationListPage.displayName = 'ConversationListPage'
export default ConversationListPage

function ConversationListPageTitlebar() {
  const { t } = useTranslation()

  return (
    <div className="flex gap-2 items-center justify-between h-full pl-3">
      <div className="flex items-center gap-2">
        <MessageSquare />
        <div className="text-lg font-semibold">{t('Conversations')}</div>
      </div>
      <HideUntrustedContentButton type="notifications" size="titlebar-icon" />
    </div>
  )
}
