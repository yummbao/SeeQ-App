import { Alert as NativeAlert, type AlertButton } from 'react-native';
import { AppSpeech, describeButton, getSpeechRevision } from './app-speech';

function spokenButtons(buttons?: AlertButton[]): AlertButton[] {
  return (buttons ?? [{ text: '확인' }]).map(button => ({
    ...button,
    onPress: (value?: string | { login: string; password: string }) => {
      const before = getSpeechRevision();
      if (button.onPress) Reflect.apply(button.onPress, undefined, [value]);
      if (getSpeechRevision() === before) describeButton(button.text || '확인');
    },
  }));
}

// With system screen reading unused, validation results must also be audible.
export const AppAlert = {
  alert: (...args: Parameters<typeof NativeAlert.alert>) => {
    const [title, message, buttons, options] = args;
    describeButton(title ?? '알림');
    NativeAlert.alert(title, message, spokenButtons(buttons), options);
  },
  prompt: (...args: Parameters<typeof NativeAlert.prompt>) => {
    const [title, message, callbackOrButtons, ...rest] = args;
    describeButton(title ?? '알림');
    // Do not read text entered into the prompt, which may contain private data.
    const callback = typeof callbackOrButtons === 'function'
      ? (value: string) => { AppSpeech.speak('확인'); callbackOrButtons(value); }
      : spokenButtons(callbackOrButtons ?? undefined);
    NativeAlert.prompt(title, message, callback, ...rest);
  },
};
