import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";

/**
 * Consome a Response SSE do chat e reconstrói a mensagem do assistente como o useChat faria.
 * `continues`: mensagem existente sobre a qual os chunks se aplicam (continuação após aprovação).
 */
export async function readChatResponse(response: Response, continues?: UIMessage): Promise<UIMessage | undefined> {
  const chunks = response.body!
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, UIMessageChunk>({
        transform(text, controller) {
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") controller.enqueue(JSON.parse(line.slice(6)));
          }
        },
      }),
    );
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream: chunks, message: continues })) last = message;
  return last;
}
