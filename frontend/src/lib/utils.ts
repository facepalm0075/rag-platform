import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function scrollToBottom(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    element.scrollTo({
      top: element.scrollHeight,
      behavior: "smooth",
    });

    const check = () => {
      const distance =
        element.scrollHeight -
        element.clientHeight -
        element.scrollTop;

      if (distance <= 1) {
        resolve();
        return;
      }

      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  });
}

export function observeElementForSelector(
  element: HTMLElement,
  selector: string,
  callback: (element: Element) => void
) {
  const observer = new MutationObserver(() => {
    debugger
    const target = element.querySelector(selector);

    if (target) {
      callback(target);
    }
  });

  observer.observe(element, {
    childList: true,
    subtree: true,
  });

  return () => observer.disconnect();
}

export function cleanExtractedText(text: string): string {
  return text
    .replace(/\0/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}