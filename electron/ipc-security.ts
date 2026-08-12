export interface IpcSenderIdentity {
  senderWebContentsId: number;
  expectedWebContentsId: number | null;
  senderFrameRoutingId: number;
  mainFrameRoutingId: number;
  senderFrameUrl: string;
  allowedOrigin: string;
}

/** Pure identity check kept separate so subframe/window spoofing is regression-tested. */
export function isTrustedIpcSender(identity: IpcSenderIdentity): boolean {
  if (
    identity.expectedWebContentsId == null ||
    identity.senderWebContentsId !== identity.expectedWebContentsId ||
    identity.senderFrameRoutingId !== identity.mainFrameRoutingId ||
    !identity.senderFrameUrl ||
    identity.senderFrameUrl === "about:blank"
  )
    return false;
  try {
    return new URL(identity.senderFrameUrl).origin === identity.allowedOrigin;
  } catch {
    return false;
  }
}
