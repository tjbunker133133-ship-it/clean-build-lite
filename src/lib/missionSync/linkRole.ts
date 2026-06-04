import type { MissionAnswerPacket, MissionLinkRole, MissionOfferPacket } from './types'

export function offerLinkRole(offer: MissionOfferPacket): MissionLinkRole {
  return offer.linkRole === 'observer' ? 'observer' : 'member'
}

export function answerLinkRole(answer: MissionAnswerPacket): MissionLinkRole {
  return answer.linkRole === 'observer' ? 'observer' : 'member'
}

export function isObserverOffer(offer: MissionOfferPacket): boolean {
  return offerLinkRole(offer) === 'observer'
}

export function isObserverAnswer(answer: MissionAnswerPacket): boolean {
  return answerLinkRole(answer) === 'observer'
}
