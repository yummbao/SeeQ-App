import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { TouchableOpacity } from 'react-native';
import { describeButton, getSpeechRevision } from '@/lib/app-speech';

type Props = ComponentProps<typeof TouchableOpacity> & { speechLabel?: string };

function textFromChildren(children: ReactNode): string {
  const parts: string[] = [];
  Children.forEach(children, child => {
    if (typeof child === 'string' || typeof child === 'number') parts.push(String(child));
    else if (isValidElement<{ children?: ReactNode }>(child)) parts.push(textFromChildren(child.props.children));
  });
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function SpokenButton({ speechLabel, accessibilityLabel, onPress, children, ...props }: Props) {
  const description = speechLabel || accessibilityLabel || textFromChildren(children);
  return (
    <TouchableOpacity
      {...props}
      accessibilityRole={props.accessibilityRole ?? 'button'}
      accessibilityLabel={accessibilityLabel ?? description}
      onPress={event => {
        const before = getSpeechRevision();
        onPress?.(event);
        // Existing immediate feedback (e.g. favorite added or SOS) takes precedence.
        if (getSpeechRevision() === before) describeButton(description);
      }}
    >
      {children}
    </TouchableOpacity>
  );
}
