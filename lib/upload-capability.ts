import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const secret =
  process.env.R2_UPLOAD_SIGNING_SECRET;

if (!secret) {
  throw new Error(
    "R2_UPLOAD_SIGNING_SECRET is not configured"
  );
}

const signingSecret = secret;

function base64UrlEncode(
  value: string | Buffer
) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(
  value: string
) {
  return Buffer.from(
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

function sign(value: string) {
  return base64UrlEncode(
    createHmac(
      "sha256",
      signingSecret
    )
      .update(value)
      .digest()
  );
}

/* --------------------------------------------------
   UPLOAD CAPABILITY
-------------------------------------------------- */

export type UploadCapabilityPayload = {
  videoId: string;
  objectKey: string;
  fileSize: number;
  contentType: string;
  exp: number;
};

export function createUploadCapability(
  payload: Omit<
    UploadCapabilityPayload,
    "exp"
  >,
  expiresInSeconds = 6 * 60 * 60
) {
  const body: UploadCapabilityPayload = {
    ...payload,
    exp:
      Math.floor(Date.now() / 1000) +
      expiresInSeconds,
  };

  const encodedPayload =
    base64UrlEncode(
      JSON.stringify(body)
    );

  const signature =
    sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

/* --------------------------------------------------
   COMPLETION PROOF
-------------------------------------------------- */

export type CompletionProofPayload = {
  videoId: string;
  objectKey: string;
  uploadId: string;
  size: number;
  etag: string;
  exp: number;
};

export function verifyCompletionProof(
  token: string
): CompletionProofPayload {
  const [
    encodedPayload,
    providedSignature,
  ] = token.split(".");

  if (
    !encodedPayload ||
    !providedSignature
  ) {
    throw new Error(
      "Invalid completion proof"
    );
  }

  const expectedSignature =
    sign(encodedPayload);

  const provided =
    Buffer.from(providedSignature);

  const expected =
    Buffer.from(expectedSignature);

  if (
    provided.length !==
      expected.length ||
    !timingSafeEqual(
      provided,
      expected
    )
  ) {
    throw new Error(
      "Invalid completion proof signature"
    );
  }

  let payload:
    | CompletionProofPayload;

  try {
    payload = JSON.parse(
      base64UrlDecode(
        encodedPayload
      )
    ) as CompletionProofPayload;
  } catch {
    throw new Error(
      "Invalid completion proof payload"
    );
  }

  if (
    !payload.videoId ||
    !payload.objectKey ||
    !payload.uploadId ||
    !Number.isFinite(payload.size) ||
    !payload.etag ||
    !payload.exp
  ) {
    throw new Error(
      "Invalid completion proof payload"
    );
  }

  if (
    payload.exp <=
    Math.floor(Date.now() / 1000)
  ) {
    throw new Error(
      "Completion proof has expired"
    );
  }

  return payload;
}