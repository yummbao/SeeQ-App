import type { Alert as NativeAlert, AlertButton } from 'react-native';
import { describeButton, getSpeechRevision } from './app-speech';

function invoke(button: AlertButton | undefined, value?: string) {
  const before = getSpeechRevision();
  if (button?.onPress) Reflect.apply(button.onPress, undefined, [value]);
  if (getSpeechRevision() === before) describeButton(button?.text ?? '확인');
}
export const AppAlert = {
  alert: (...args: Parameters<typeof NativeAlert.alert>) => {
    if (typeof window === 'undefined') return;
    const [title, message, buttons] = args;
    describeButton(title ?? '알림');
    const text = [title, message].filter(Boolean).join('\n\n');
    if (!buttons || buttons.length < 2) {
      window.alert(text); invoke(buttons?.[0]);
    } else {
      const positive = [...buttons].reverse().find(button => button.style !== 'cancel');
      const negative = buttons.find(button => button.style === 'cancel') ?? buttons[0];
      invoke(window.confirm(`${text}\n\n확인: ${positive?.text ?? '확인'} / 취소: ${negative?.text ?? '취소'}`) ? positive : negative);
    }
  },
  prompt: (...args: Parameters<typeof NativeAlert.prompt>) => {
    if (typeof window === 'undefined') return;
    const [title, message, callbackOrButtons, , initialValue] = args;
    describeButton(title ?? '입력');
    const input = window.prompt([title, message].filter(Boolean).join('\n\n'), initialValue ?? '');
    if (typeof callbackOrButtons === 'function') {
      if (input !== null) callbackOrButtons(input);
    } else if (input === null) invoke(callbackOrButtons?.find(button => button.style === 'cancel'));
    else invoke([...(callbackOrButtons ?? [])].reverse().find(button => button.style !== 'cancel'), input);
  },
};
