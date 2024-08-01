import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useLogger } from '@/hooks/useLogger.ts';
import { formatMessage, sendEventToLuna, wsIsActivated } from '@/components/Terminal/helper';
import { AsciiBackspace, AsciiCtrlC, AsciiCtrlZ, AsciiDel, defaultTheme } from '@/config';

import type { ILunaConfig } from './interface';

import xtermTheme from 'xterm-theme';
import ZmodemBrowser, { SentryConfig } from 'nora-zmodemjs/src/zmodem_browser';
import { ref } from 'vue';

const { debug } = useLogger('Terminal-Hook');

export const useTerminal = () => {
  let termSelectionText = ref<string>('');

  const createZsentry = (config: SentryConfig) => {
    return new ZmodemBrowser.Sentry(config);
  };

  const setTerminalTheme = (
    themeName: string,
    terminal: Terminal,
    emits?: (event: 'background-color', backgroundColor: string) => void
  ) => {
    const theme = xtermTheme[themeName] || defaultTheme;

    terminal.options.theme = theme;

    debug(`Theme: ${themeName}`);

    emits && emits('background-color', theme.background);
  };

  /**
   * @description 用于附加自定义的键盘事件处理程序,允许开发者拦截和处理终端中的键盘事件
   */
  const handleCustomKeyEvent = (e: KeyboardEvent, terminal: Terminal) => {
    if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      switch (e.key) {
        case 'ArrowRight':
          sendEventToLuna('KEYEVENT', 'alt+right');
          break;
        case 'ArrowLeft':
          sendEventToLuna('KEYEVENT', 'alt+left');
          break;
      }
    }

    if (e.ctrlKey && e.key === 'c' && terminal.hasSelection()) {
      return false;
    }

    return !(e.ctrlKey && e.key === 'v');
  };

  /**
   * @description 处理右键菜单事件
   * @param {MouseEvent} e 鼠标事件
   * @param {ILunaConfig} config Luna 配置
   */
  const handleContextMenu = async (e: MouseEvent, config: ILunaConfig) => {
    if (e.ctrlKey || config.quickPaste !== '1') return;

    let text: string = '';

    try {
      text = await navigator.clipboard.readText();
    } catch {
      if (termSelectionText.value !== '') {
        text = termSelectionText.value;
      }
    }

    e.preventDefault();

    //todo))
    // if (wsIsActivated(ws)) {
    //   ws.send(formatMessage(terminalId.value, 'TERMINAL_DATA', text));
    // }

    return text;
  };

  /**
   * @description 在不支持 clipboard 时的降级方案
   * @param text
   */
  const fallbackCopyTextToClipboard = (text: string): void => {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // Avoid scrolling to bottom
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand('copy');
      const msg = successful ? 'successful' : 'unsuccessful';
      debug('Fallback: Copying text command was ' + msg);
    } catch (err) {
      console.error('Fallback: Oops, unable to copy', err);
    }

    document.body.removeChild(textArea);
  };

  /**
   * @description 获取当前终端中的选定文本  handleSelectionChange
   */
  const handleSelection = async (terminal: Terminal) => {
    debug('Select Change');

    termSelectionText.value = terminal.getSelection().trim();

    if (!navigator.clipboard) return fallbackCopyTextToClipboard(termSelectionText.value);

    try {
      await navigator.clipboard.writeText(termSelectionText.value);
    } catch (e) {
      fallbackCopyTextToClipboard(termSelectionText.value);
    }
  };

  /**
   * @description 对用户设置的特定键映射配置
   * @param data
   */
  const preprocessInput = (data: string) => {
    // 如果配置项 backspaceAsCtrlH 启用（值为 "1"），并且输入数据包含删除键的 ASCII 码 (AsciiDel，即 127)，
    // 它会将其替换为退格键的 ASCII 码 (AsciiBackspace，即 8)
    if (config.backspaceAsCtrlH === '1') {
      if (data.charCodeAt(0) === AsciiDel) {
        data = String.fromCharCode(AsciiBackspace);
        debug('backspaceAsCtrlH enabled');
      }
    }

    // 如果配置项 ctrlCAsCtrlZ 启用（值为 "1"），并且输入数据包含 Ctrl+C 的 ASCII 码 (AsciiCtrlC，即 3)，
    // 它会将其替换为 Ctrl+Z 的 ASCII 码 (AsciiCtrlZ，即 26)。
    if (config.ctrlCAsCtrlZ === '1') {
      if (data.charCodeAt(0) === AsciiCtrlC) {
        data = String.fromCharCode(AsciiCtrlZ);
        debug('ctrlCAsCtrlZ enabled');
      }
    }
    return data;
  };

  /**
   * @description 初始化 Terminal 相关事件
   * @param {Terminal} terminal Terminal 实例
   * @param {FitAddon} fitAddon 实例
   * @param {HTMLElement} el Terminal 所挂载的节点
   * @param {ILunaConfig} config Luna 的配置
   */
  const initEvent = (
    terminal: Terminal,
    fitAddon: FitAddon,
    el: HTMLElement,
    config: ILunaConfig
  ): void => {
    // 初始化 window.resize 事件
    window.addEventListener(
      'resize',
      () => {
        fitAddon.fit();
        debug(`Windows resize event, ${terminal.cols}, ${terminal.rows}, ${terminal}`);
      },
      false
    );

    // 初始化节点的鼠标事件
    el.addEventListener('mouseenter', () => terminal.focus(), false);
    el.addEventListener('contextmenu', ($event: MouseEvent) => handleContextMenu($event, config));

    // 初始化 Terminal 实例事件
    terminal.onSelectionChange(() => handleSelection(terminal));
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) =>
      handleCustomKeyEvent(event, terminal)
    );
  };

  /**
   * @description 创建 Terminal
   * @param {HTMLElement} el
   * @param {ILunaConfig} config
   */
  const createTerminal = (el: HTMLElement, config: ILunaConfig) => {
    const terminal: Terminal = new Terminal({
      fontSize: config.fontSize,
      lineHeight: config.lineHeight,
      fontFamily: 'monaco, Consolas, "Lucida Console", monospace',
      rightClickSelectsWord: true,
      theme: {
        background: '#1E1E1E'
      },
      scrollback: 5000
    });
    const fitAddon: FitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(el);
    fitAddon.fit();
    terminal.focus();

    initEvent(terminal, fitAddon, el, config);

    return terminal;
  };

  return {
    createZsentry,
    createTerminal,
    preprocessInput,
    handleContextMenu,
    setTerminalTheme,
    handleCustomKeyEvent
  };
};
