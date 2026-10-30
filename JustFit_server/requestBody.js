// JSON body parsing with a hard byte cap, for the upload route (its bodies are far larger
// than the 200 kB the profile routes allow). Express middleware: sets req.body or answers.
//
// The body is counted as it arrives on the request stream, so neither a missing nor an
// understated Content-Length helps an attacker: a declared size over the cap is refused
// before a single byte is read, and otherwise actual bytes are what count. Nothing past
// the cap is kept in memory.
//
// Once the cap is crossed, up to another `maxBytes` is read and thrown away so that a
// client that is only a little over finishes sending and receives the 413 cleanly
// (closing a socket with unread data makes the kernel reset the connection, and the
// client may never see the response). A body far over the cap is abandoned at that
// point and the connection is closed; that client gets a reset, which is fine.

function jsonBodyWithLimit(maxBytes) {
  const maxMb = Math.round(maxBytes / 1024 / 1024);
  return (req, res, next) => {
    const tooLarge = () => {
      res.set("Connection", "close"); // part of the body is unread: the connection can't be reused
      res.status(413).json({ error: `The request is too large (max ${maxMb} MB).` });
    };
    const unreadable = () => res.status(400).json({ error: "The request couldn't be read." });

    const declared = req.get("content-length");
    if (declared !== undefined && declared.trim() !== "") {
      const length = Number(declared);
      if (!Number.isFinite(length) || length < 0) return unreadable();
      if (length > maxBytes) return tooLarge();
    }

    const chunks = [];
    let received = 0;
    let overflowed = false;
    let finished = false;
    const finish = (answer) => {
      if (finished) return;
      finished = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      answer();
    };
    const onData = (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        overflowed = true;
        chunks.length = 0;
        if (received > maxBytes * 2) {
          req.pause(); // abandon the rest; the 413 goes out and the connection closes
          finish(tooLarge);
        }
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () =>
      finish(() => {
        if (overflowed) return tooLarge();
        try {
          req.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          // The body was read in full, so the connection stays reusable
          return res.status(400).json({ error: "The request body isn't valid JSON." });
        }
        next();
      });
    const onError = () => finish(unreadable);

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  };
}

module.exports = { jsonBodyWithLimit };
