import { Capacitor, registerPlugin } from '@capacitor/core'
import type { IncomingNotification, NotificationReport } from './processor'

export interface NotificationBridgePlugin {
  isNotificationAccessEnabled(): Promise<{ enabled: boolean; serviceBound?: boolean }>
  openNotificationAccessSettings(): Promise<void>
  requestPostNotificationPermission(): Promise<{ granted: boolean }>
  getPendingNotifications(): Promise<{ notifications: IncomingNotification[] }>
  scanActiveNotifications(): Promise<{
    notifications: IncomingNotification[]
    serviceBound?: boolean
  }>
  postAnalysisReportNotification(options: {
    id: number
    title: string
    body: string
    priority: string
  }): Promise<void>
  addListener(
    eventName: 'notificationReceived',
    listenerFunc: (data: IncomingNotification) => void
  ): Promise<{ remove: () => Promise<void> }>
}

const NotificationBridge = registerPlugin<NotificationBridgePlugin>('NotificationBridge')

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function getNotificationListenerStatus(): Promise<{
  enabled: boolean
  serviceBound: boolean
}> {
  if (!isNativeAndroid()) return { enabled: false, serviceBound: false }
  try {
    const res = await NotificationBridge.isNotificationAccessEnabled()
    return {
      enabled: Boolean(res.enabled),
      serviceBound: Boolean(res.serviceBound),
    }
  } catch {
    return { enabled: false, serviceBound: false }
  }
}

export async function openAndroidNotificationSettings(): Promise<void> {
  if (!isNativeAndroid()) return
  await NotificationBridge.openNotificationAccessSettings()
}

export async function requestPushPermission(): Promise<boolean> {
  if (isNativeAndroid()) {
    try {
      const res = await NotificationBridge.requestPostNotificationPermission()
      return res.granted
    } catch {
      return false
    }
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const perm = await Notification.requestPermission()
  return perm === 'granted'
}

export function getWebPushPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function dispatchReportPushNotification(
  report: NotificationReport
): Promise<boolean> {
  const numericId = Math.floor(Date.now() % 2147483647)

  if (isNativeAndroid()) {
    try {
      await NotificationBridge.postAnalysisReportNotification({
        id: numericId,
        title: report.summaryTitle,
        body: report.summaryBody,
        priority: report.priority,
      })
      return true
    } catch (e) {
      console.warn('Native notification dispatch failed:', e)
      return false
    }
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false
  }

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(report.summaryTitle, {
          body: report.summaryBody,
          icon: '/logo.png',
          badge: '/logo.png',
          tag: `micropilot-${report.id}`,
        })
        return true
      }
    }
    new Notification(report.summaryTitle, {
      body: report.summaryBody,
      icon: '/logo.png',
    })
    return true
  } catch (e) {
    console.warn('Web notification dispatch failed:', e)
    return false
  }
}

export async function drainPendingNotifications(): Promise<IncomingNotification[]> {
  if (!isNativeAndroid()) return []
  try {
    const pending = await NotificationBridge.getPendingNotifications()
    return pending.notifications || []
  } catch {
    return []
  }
}

export async function scanActiveShadeNotifications(): Promise<{
  notifications: IncomingNotification[]
  serviceBound: boolean
}> {
  if (!isNativeAndroid()) return { notifications: [], serviceBound: false }
  try {
    const res = await NotificationBridge.scanActiveNotifications()
    return {
      notifications: res.notifications || [],
      serviceBound: Boolean(res.serviceBound),
    }
  } catch {
    return { notifications: [], serviceBound: false }
  }
}

export async function subscribeToIncomingNotifications(
  onReceive: (notif: IncomingNotification) => void
): Promise<() => void> {
  let removeHandle: { remove: () => Promise<void> } | null = null

  if (isNativeAndroid()) {
    try {
      const pending = await drainPendingNotifications()
      for (const n of pending) {
        onReceive(n)
      }
      removeHandle = await NotificationBridge.addListener('notificationReceived', (data) => {
        onReceive(data)
      })
    } catch (e) {
      console.warn('Failed to attach native notification listener:', e)
    }
  }

  return () => {
    if (removeHandle) {
      removeHandle.remove().catch(() => {})
    }
  }
}

export function consumeSharedTargetPayload(): IncomingNotification | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const title = params.get('share_title') || ''
    const text = params.get('share_text') || ''
    const url = params.get('share_url') || ''
    const combinedText = [text, url].filter(Boolean).join(' ').trim()

    if (!title && !combinedText) return null

    const cleanUrl = window.location.pathname
    window.history.replaceState({}, document.title, cleanUrl)

    return {
      id: `share_${Date.now()}`,
      packageName: 'android.share.target',
      appName: 'Shared App',
      title: title || 'Shared Message',
      text: combinedText || title,
      timestamp: Date.now(),
    }
  } catch {
    return null
  }
}
