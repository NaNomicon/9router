export function createModelTestStreamParser() {
  let buffer = "";
  let sawDone = false;
  let sawChunk = false;
  let sawContent = false;
  let streamError = null;

  const processBuffer = (flush = false) => {
    const events = buffer.split("\n\n");
    buffer = flush ? "" : (events.pop() || "");

    for (const event of events) {
      const dataLines = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      for (const dataLine of dataLines) {
        if (dataLine === "[DONE]") {
          sawDone = true;
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }

        sawChunk = true;

        if (parsed?.error) {
          streamError = parsed?.error?.message || parsed?.error || "Provider returned an error during streaming";
          return;
        }

        const deltaContent = parsed?.choices?.some((choice) => {
          const content = choice?.delta?.content;
          if (Array.isArray(content)) {
            return content.some((part) => typeof part?.text === "string" && part.text.length > 0);
          }
          return typeof content === "string" && content.length > 0;
        });

        if (deltaContent || parsed?.choices?.some((choice) => choice?.finish_reason)) {
          sawContent = true;
        }
      }
    }
  };

  return {
    addChunk(chunk) {
      buffer += chunk;
      processBuffer(false);
    },
    flush() {
      processBuffer(true);
    },
    getState() {
      return { sawDone, sawChunk, sawContent, streamError };
    },
  };
}
