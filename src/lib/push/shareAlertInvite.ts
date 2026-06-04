import { copyMissionBundle } from '../missionSync/shareBundle'
import { buildAlertInviteText } from './alertSubscribeUrl'

export async function shareAlertInvite(args: {
  operatorName: string
  watchToken: string
  contactEmail?: string
}): Promise<'shared' | 'copied' | 'failed'> {
  const text = buildAlertInviteText(args)
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title: 'Signal One — alert notifications', text })
      return 'shared'
    }
  } catch {
    /* fall through */
  }
  const copied = await copyMissionBundle(text)
  return copied ? 'copied' : 'failed'
}
