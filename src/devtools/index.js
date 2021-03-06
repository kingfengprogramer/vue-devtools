import Vue from 'vue'
import App from './App.vue'
import store from './store'
import './plugins'
import { parse } from '../util'

// Env

const isChrome = typeof chrome !== 'undefined' && !!chrome.devtools
const isMac = navigator.platform === 'MacIntel'
const keys = {
  ctrl: isMac ? '&#8984;' : 'Ctrl',
  shift: 'Shift',
  alt: isMac ? '&#8997;' : 'Alt'
}

Object.defineProperties(Vue.prototype, {
  '$isChrome': { get: () => isChrome },
  '$isMac': { get: () => isMac },
  '$keys': { get: () => keys }
})

// UI

let panelShown = !isChrome
let pendingAction = null

const isDark = isChrome ? chrome.devtools.panels.themeName === 'dark' : false

// Capture and log devtool errors when running as actual extension
// so that we can debug it by inspecting the background page.
// We do want the errors to be thrown in the dev shell though.
if (isChrome) {
  Vue.config.errorHandler = (e, vm) => {
    bridge.send('ERROR', {
      message: e.message,
      stack: e.stack,
      component: vm.$options.name || vm.$options._componentTag || 'anonymous'
    })
  }

  chrome.runtime.onMessage.addListener(request => {
    if (request === 'vue-panel-shown') {
      onPanelShown()
    } else if (request === 'vue-panel-hidden') {
      onPanelHidden()
    } else if (request === 'vue-get-context-menu-target') {
      getContextMenuInstance()
    }
  })
}

Vue.options.renderError = (h, e) => {
  return h('pre', {
    style: {
      backgroundColor: 'red',
      color: 'white',
      fontSize: '12px',
      padding: '10px'
    }
  }, e.stack)
}

let app = null

/**
 * Create the main devtools app. Expects to be called with a shell interface
 * which implements a connect method.
 *
 * @param {Object} shell
 *        - connect(bridge => {})
 *        - onReload(reloadFn)
 */

export function initDevTools (shell) {
  initApp(shell)
  shell.onReload(() => {
    if (app) {
      app.$destroy()
    }
    bridge.removeAllListeners()
    initApp(shell)
  })
}

/**
 * Connect then init the app. We need to reconnect on every reload, because a
 * new backend will be injected.
 *
 * @param {Object} shell
 */

function initApp (shell) {
  shell.connect(bridge => {
    window.bridge = bridge

    bridge.once('ready', version => {
      store.commit(
        'SHOW_MESSAGE',
        'Ready. Detected Vue ' + version + '.'
      )
      bridge.send('vuex:toggle-recording', store.state.vuex.enabled)
      bridge.send('events:toggle-recording', store.state.events.enabled)

      if (isChrome) {
        chrome.runtime.sendMessage('vue-panel-load')
      }
    })

    bridge.once('proxy-fail', () => {
      store.commit(
        'SHOW_MESSAGE',
        'Proxy injection failed.'
      )
    })

    bridge.on('flush', payload => {
      store.commit('components/FLUSH', parse(payload))
    })

    bridge.on('instance-details', details => {
      store.commit('components/RECEIVE_INSTANCE_DETAILS', parse(details))
    })

    bridge.on('toggle-instance', payload => {
      store.commit('components/TOGGLE_INSTANCE', parse(payload))
    })

    bridge.on('vuex:init', snapshot => {
      store.commit('vuex/INIT', snapshot)
    })

    bridge.on('vuex:mutation', payload => {
      store.commit('vuex/RECEIVE_MUTATION', payload)
    })

    bridge.on('event:triggered', payload => {
      store.commit('events/RECEIVE_EVENT', parse(payload))
      if (store.state.tab !== 'events') {
        store.commit('events/INCREASE_NEW_EVENT_COUNT')
      }
    })

    bridge.on('inspect-instance', id => {
      ensurePaneShown(() => {
        inspectInstance(id)
      })
    })

    app = new Vue({
      extends: App,
      store,
      data: {
        isDark
      },
      watch: {
        isDark: {
          handler (value) {
            if (value) {
              document.body.classList.add('dark')
            } else {
              document.body.classList.remove('dark')
            }
          },
          immediate: true
        }
      }
    }).$mount('#app')

    store.dispatch('init')
  })
}

function getContextMenuInstance () {
  bridge.send('get-context-menu-target')
}

function inspectInstance (id) {
  bridge.send('select-instance', id)
  store.commit('SWITCH_TAB', 'components')
  const instance = store.state.components.instancesMap[id]
  instance && store.dispatch('components/toggleInstance', {
    instance,
    expanded: true,
    parent: true
  })
}

// Pane visibility management

function ensurePaneShown (cb) {
  if (panelShown) {
    cb()
  } else {
    pendingAction = cb
  }
}

function onPanelShown () {
  panelShown = true
  if (pendingAction) {
    pendingAction()
    pendingAction = null
  }
}

function onPanelHidden () {
  panelShown = false
}
