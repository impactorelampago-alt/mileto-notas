export type OpsRefreshOutcome = 'complete' | 'partial' | 'stale' | 'skipped'

type RefreshAdmission =
  | { kind: 'run' }
  | { kind: 'queued'; promise: Promise<OpsRefreshOutcome> }
  | { kind: 'skipped'; outcome: 'skipped' }

interface PendingRefresh {
  reason: string
  promise: Promise<OpsRefreshOutcome>
  resolve: (outcome: OpsRefreshOutcome) => void
}

function refreshPriority(reason: string): number {
  if (reason === 'manual-sync') return 100
  if (reason === 'view-switch' || reason === 'view-all-toggle') return 90
  if (reason === 'initial-load') return 80
  return 10
}

export function preferRefreshReason(current: string, incoming: string): string {
  return refreshPriority(incoming) > refreshPriority(current) ? incoming : current
}

/**
 * Single-flight coordinator for the Ops snapshot.
 *
 * Every non-polling caller that arrives during a refresh receives the Promise of
 * the next real cycle. This is important for the manual retry button and account
 * switches: awaiting the action must never mean merely "queued".
 */
export class OpsRefreshCoordinator {
  private running = false
  private pending: PendingRefresh | null = null

  admit(reason: string): RefreshAdmission {
    if (!this.running) {
      this.running = true
      return { kind: 'run' }
    }

    // Polling is only a backstop and must not create an ever-growing queue.
    if (reason.startsWith('polling-')) return { kind: 'skipped', outcome: 'skipped' }

    if (!this.pending) {
      let resolve!: (outcome: OpsRefreshOutcome) => void
      const promise = new Promise<OpsRefreshOutcome>((done) => { resolve = done })
      this.pending = { reason, promise, resolve }
    } else {
      this.pending.reason = preferRefreshReason(this.pending.reason, reason)
    }

    return { kind: 'queued', promise: this.pending.promise }
  }

  /**
   * Releases the current flight and immediately starts the queued reason, if
   * any. The queued Promise resolves with that cycle's actual outcome.
   */
  finish(runNext: (reason: string) => Promise<OpsRefreshOutcome>): void {
    this.running = false
    const pending = this.pending
    this.pending = null
    if (!pending) return

    try {
      void runNext(pending.reason).then(pending.resolve, () => pending.resolve('partial'))
    } catch {
      pending.resolve('partial')
    }
  }
}
