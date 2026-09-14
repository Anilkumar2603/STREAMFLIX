function unauthorized(
  cors: Record<string, string> = {}
) {
  return new Response("Unauthorized", {
    status: 401,
    headers: cors,
  });
}

function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  return Response.json(data, {
    status,
    headers: extraHeaders,
  });
}

/* --------------------------------------------------
   CORS
-------------------------------------------------- */

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin");

  const headers: Record<string, string> = {
    // The Worker is protected by bearer/capability tokens for private
    // operations, so cross-origin browser requests can safely use a
    // wildcard origin. This also supports the deployed STREAMFLIX app
    // without needing to hard-code its final domain here.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };

  return headers;
}

/* --------------------------------------------------
   MASTER TOKEN AUTH
-------------------------------------------------- */

function getToken(request: Request): string | null {
  const header = request.headers.get("Authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim() || null;
}

function isAuthorized(
  request: Request,
  env: Env
): boolean {
  const token = getToken(request);

  return Boolean(
    token && token === env.WORKER_AUTH_TOKEN
  );
}

/* --------------------------------------------------
   UPLOAD CAPABILITY
-------------------------------------------------- */

type UploadCapabilityPayload = {
  videoId: string;
  objectKey: string;
  fileSize: number;
  contentType: string;
  exp: number;
};

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded =
    normalized +
    "=".repeat(
      (4 - (normalized.length % 4)) % 4
    );

  const binary = atob(padded);

  return Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0)
  );
}
function base64UrlEncode(
  value: string | Uint8Array
) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : value;

  let binary = "";

  for (
    const byte of bytes
  ) {
    binary += String.fromCharCode(
      byte
    );
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
async function verifyUploadCapability(
  token: string,
  env: Env
): Promise<UploadCapabilityPayload> {
  const [encodedPayload, encodedSignature] =
    token.split(".");

  if (!encodedPayload || !encodedSignature) {
    throw new Error(
      "Invalid upload capability"
    );
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(
      env.UPLOAD_SIGNING_SECRET
    ),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(encodedSignature),
    new TextEncoder().encode(encodedPayload)
  );

  if (!valid) {
    throw new Error(
      "Invalid upload capability signature"
    );
  }

  let payload: UploadCapabilityPayload;

  try {
    payload = JSON.parse(
      new TextDecoder().decode(
        base64UrlDecode(encodedPayload)
      )
    ) as UploadCapabilityPayload;
  } catch {
    throw new Error(
      "Invalid upload capability payload"
    );
  }

  if (
    !payload.videoId ||
    !payload.objectKey ||
    !Number.isFinite(payload.fileSize) ||
    payload.fileSize <= 0 ||
    !payload.contentType ||
    !Number.isFinite(payload.exp)
  ) {
    throw new Error(
      "Invalid upload capability payload"
    );
  }

  if (
    payload.exp <=
    Math.floor(Date.now() / 1000)
  ) {
    throw new Error(
      "Upload capability has expired"
    );
  }

  return payload;
}
async function createCompletionProof(
  payload: {
    videoId: string;
    objectKey: string;
    uploadId: string;
    size: number;
    etag: string;
  },
  env: Env
) {
  const body = {
    ...payload,
    exp:
      Math.floor(Date.now() / 1000) +
      10 * 60,
  };

  const encodedPayload =
    base64UrlEncode(
      JSON.stringify(body)
    );

  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(
        env.UPLOAD_SIGNING_SECRET
      ),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        encodedPayload
      )
    );

  return `${encodedPayload}.${base64UrlEncode(
    new Uint8Array(signature)
  )}`;
}
async function getUploadCapability(
  request: Request,
  env: Env
) {
  const token = getToken(request);

  if (!token) {
    throw new Error(
      "Upload capability is required"
    );
  }

  return verifyUploadCapability(
    token,
    env
  );
}

/* --------------------------------------------------
   CAPABILITY OBJECT KEY VALIDATION
-------------------------------------------------- */

function validateCapabilityKey(
  capability: UploadCapabilityPayload,
  key: string | null
) {
  if (!key) {
    throw new Error("key is required");
  }

  if (key !== capability.objectKey) {
    throw new Error(
      "Upload capability does not permit this object"
    );
  }
}

/* --------------------------------------------------
   MULTIPART CONSTANTS
-------------------------------------------------- */

const PART_PREFIX =
  "__streamflix_multipart/";

/* --------------------------------------------------
   WORKER
-------------------------------------------------- */

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const cors = corsHeaders(request);

    try {
      /* --------------------------------------------------
         CORS PREFLIGHT
      -------------------------------------------------- */

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: cors,
        });
      }

      const url = new URL(request.url);
      const action =
        url.searchParams.get("action");

      /* --------------------------------------------------
         PUBLIC STREAMING MEDIA

         Only processed streams and manually uploaded subtitles
         are publicly readable. Original uploads remain private.
      -------------------------------------------------- */

      if (
        (request.method === "GET" || request.method === "HEAD") &&
        url.pathname.startsWith("/media/")
      ) {
        const objectKey =
          url.pathname.slice("/media/".length);

        const isPublicMedia =
          objectKey.startsWith("streams/") ||
          objectKey.startsWith("subtitles/")||
		  objectKey.startsWith("thumbnails/");


        const hasTraversal =
          objectKey.split("/").some(
            (part) => part === ".." || part === "."
          );

        if (!isPublicMedia || hasTraversal || objectKey.includes("\\")) {
          return new Response("Not found", {
            status: 404,
            headers: cors,
          });
        }

        const cache = caches.default;

        const cacheKey = new Request(
          request.url,
          request
        );

        const cached =
          await cache.match(cacheKey);

        if (cached) {
          return cached;
        }

        const object =
          await env.MEDIA_BUCKET.get(
            objectKey
          );

        if (!object) {
          return new Response("Not found", {
            status: 404,
            headers: cors,
          });
        }

        const isPlaylist =
          objectKey.endsWith(".m3u8");

        const isSubtitle =
          objectKey.endsWith(".vtt");

        const contentType =
          object.httpMetadata?.contentType ||
          (isPlaylist
            ? "application/vnd.apple.mpegurl"
            : isSubtitle
              ? "text/vtt; charset=utf-8"
              : "application/octet-stream");

        const headers: Record<string, string> = {
          ...cors,
          "Content-Type": contentType,
          "Content-Length": String(object.size),
          "Accept-Ranges": "bytes",
          "Cache-Control":
            isPlaylist
              ? "public, max-age=60"
              : "public, max-age=31536000, immutable",
        };

        const response = new Response(
          request.method === "HEAD"
            ? null
            : object.body,
          {
            status: 200,
            headers,
          }
        );

        await cache.put(
          cacheKey,
          response.clone()
        );

        return response;
      }
      /* --------------------------------------------------
         BROWSER MULTIPART ACTIONS

         These use the short-lived signed capability
         instead of WORKER_AUTH_TOKEN.
      -------------------------------------------------- */

      const isMultipartAction =
        action === "create" ||
        action === "uploadpart" ||
        action === "parts" ||
        action === "complete" ||
        action === "abort";

      let uploadCapability:
        | UploadCapabilityPayload
        | null = null;

      if (isMultipartAction) {
        try {
          uploadCapability =
            await getUploadCapability(
              request,
              env
            );
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unauthorized",
            },
            401,
            cors
          );
        }
      } else {
        /* --------------------------------------------------
           PRIVATE OBJECT ACTIONS

           These still require the master token.
        -------------------------------------------------- */

        if (!isAuthorized(request, env)) {
          return unauthorized(cors);
        }
      }

      /* --------------------------------------------------
         OBJECT: PUT
      -------------------------------------------------- */

      if (
        request.method === "PUT" &&
        action === "put"
      ) {
        const key =
          url.searchParams.get("key");

        if (!key) {
          return json(
            { error: "key is required" },
            400
          );
        }

        await env.MEDIA_BUCKET.put(
          key,
          request.body,
          {
            httpMetadata: {
              contentType:
                request.headers.get(
                  "Content-Type"
                ) ||
                "application/octet-stream",

              cacheControl: "no-store",
            },
          }
        );

        return json({
          success: true,
          key,
        });
      }

      /* --------------------------------------------------
         OBJECT: GET
      -------------------------------------------------- */

      if (
        request.method === "GET" &&
        action === "get"
      ) {
        const key =
          url.searchParams.get("key");

        if (!key) {
          return json(
            { error: "key is required" },
            400
          );
        }

        const object =
          await env.MEDIA_BUCKET.get(key);

        if (!object) {
          return new Response(
            "Object not found",
            {
              status: 404,
              headers: cors,
            }
          );
        }

        return new Response(
          object.body,
          {
            headers: {
              ...cors,
              "Content-Type":
                object.httpMetadata
                  ?.contentType ||
                "application/octet-stream",
              "Content-Length":
                String(object.size),
            },
          }
        );
      }

      /* --------------------------------------------------
         OBJECT: HEAD
      -------------------------------------------------- */

      if (
        request.method === "GET" &&
        action === "head"
      ) {
        const key =
          url.searchParams.get("key");

        if (!key) {
          return json(
            { error: "key is required" },
            400
          );
        }

        const object =
          await env.MEDIA_BUCKET.head(key);

        if (!object) {
          return json(
            {
              exists: false,
            },
            200,
            cors
          );
        }

        return json(
          {
            exists: true,
            contentLength: object.size,
            contentType:
              object.httpMetadata
                ?.contentType,
            etag: object.httpEtag,
          },
          200,
          cors
        );
      }

      /* --------------------------------------------------
         OBJECT: DELETE
      -------------------------------------------------- */

      if (
        request.method === "DELETE" &&
        action === "delete"
      ) {
        const key =
          url.searchParams.get("key");

        if (!key) {
          return json(
            { error: "key is required" },
            400
          );
        }

        await env.MEDIA_BUCKET.delete(key);

        return json(
          {
            success: true,
          },
          200,
          cors
        );
      }

      /* --------------------------------------------------
         MULTIPART: CREATE
      -------------------------------------------------- */

      if (
        request.method === "POST" &&
        action === "create"
      ) {
        const key =
          url.searchParams.get("key");

        const contentType =
          url.searchParams.get(
            "contentType"
          ) ||
          "application/octet-stream";

        if (!uploadCapability) {
          return json(
            {
              error:
                "Upload capability is required",
            },
            401,
            cors
          );
        }

        try {
          validateCapabilityKey(
            uploadCapability,
            key
          );
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unauthorized",
            },
            403,
            cors
          );
        }

        if (
          uploadCapability.contentType &&
          contentType !==
            uploadCapability.contentType
        ) {
          return json(
            {
              error:
                "Content type does not match upload capability",
            },
            403,
            cors
          );
        }

        if (!key) {
          return json(
            { error: "key is required" },
            400,
            cors
          );
        }

        const multipart =
          await env.MEDIA_BUCKET.createMultipartUpload(
            key,
            {
              httpMetadata: {
                contentType,
              },
            }
          );

        return json(
          {
            success: true,
            uploadId:
              multipart.uploadId,
            objectKey: key,
          },
          200,
          cors
        );
      }

      /* --------------------------------------------------
         MULTIPART: UPLOAD PART
      -------------------------------------------------- */

      if (
        request.method === "PUT" &&
        action === "uploadpart"
      ) {
        const key =
          url.searchParams.get("key");

        const uploadId =
          url.searchParams.get(
            "uploadId"
          );

        const partNumberValue =
          url.searchParams.get(
            "partNumber"
          );

        const partNumber =
          Number(partNumberValue);

        if (!uploadCapability) {
          return json(
            {
              error:
                "Upload capability is required",
            },
            401,
            cors
          );
        }

        try {
          validateCapabilityKey(
            uploadCapability,
            key
          );
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unauthorized",
            },
            403,
            cors
          );
        }

        if (!key || !uploadId) {
          return json(
            {
              error:
                "key and uploadId are required",
            },
            400,
            cors
          );
        }

        if (
          !Number.isInteger(partNumber) ||
          partNumber < 1 ||
          partNumber > 10000
        ) {
          return json(
            {
              error:
                "Invalid partNumber",
            },
            400,
            cors
          );
        }


        if (
          partNumber >
          Math.ceil(
            uploadCapability.fileSize /
              (10 * 1024 * 1024)
          )
        ) {
          return json(
            {
              error:
                "Part number exceeds the upload size permitted by this capability",
            },
            403,
            cors
          );
        }

        if (!request.body) {
          return json(
            {
              error:
                "Request body is required",
            },
            400,
            cors
          );
        }

        const multipart =
          env.MEDIA_BUCKET.resumeMultipartUpload(
            key,
            uploadId
          );

        const uploadedPart =
          await multipart.uploadPart(
            partNumber,
            request.body
          );

        /*
         * Store the uploaded part's ETag
         * as a lightweight marker object.
         */

        const markerKey =
          `${PART_PREFIX}${uploadId}/${partNumber}`;

        await env.MEDIA_BUCKET.put(
          markerKey,
          "",
          {
            customMetadata: {
              partNumber:
                String(partNumber),

              etag:
                uploadedPart.etag,

              objectKey: key,

              videoId:
                uploadCapability.videoId,
            },
          }
        );

        return json(
          {
            success: true,
            partNumber,
            etag:
              uploadedPart.etag,
          },
          200,
          cors
        );
      }

      /* --------------------------------------------------
         MULTIPART: LIST PARTS
      -------------------------------------------------- */

      if (
        request.method === "GET" &&
        action === "parts"
      ) {
        const key =
          url.searchParams.get("key");

        const uploadId =
          url.searchParams.get(
            "uploadId"
          );

        if (!uploadCapability) {
          return json(
            {
              error:
                "Upload capability is required",
            },
            401,
            cors
          );
        }

        try {
          validateCapabilityKey(
            uploadCapability,
            key
          );
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unauthorized",
            },
            403,
            cors
          );
        }

        if (!uploadId) {
          return json(
            {
              error:
                "uploadId is required",
            },
            400,
            cors
          );
        }

        const prefix =
          `${PART_PREFIX}${uploadId}/`;

        const parts: Array<{
          partNumber: number;
          etag: string;
        }> = [];

        let cursor:
          | string
          | undefined;

        do {
          const result =
  await env.MEDIA_BUCKET.list({
    prefix,
    cursor,
    limit: 1000,
    include: ["customMetadata"],
  });

          for (
            const object of result.objects
          ) {
            const partNumber =
              Number(
                object.customMetadata
                  ?.partNumber
              );

            const etag =
              object.customMetadata
                ?.etag;

            const objectKey =
              object.customMetadata
                ?.objectKey;

            if (
              objectKey !== key
            ) {
              continue;
            }

            if (
              Number.isInteger(
                partNumber
              ) &&
              partNumber >= 1 &&
              etag
            ) {
              parts.push({
                partNumber,
                etag,
              });
            }
          }

          cursor =
            result.truncated
              ? result.cursor
              : undefined;
        } while (cursor);

        parts.sort(
          (a, b) =>
            a.partNumber -
            b.partNumber
        );

        return json(
          {
            success: true,
            parts,
          },
          200,
          cors
        );
      }

      /* --------------------------------------------------
         MULTIPART: COMPLETE
      -------------------------------------------------- */

      if (
        request.method === "POST" &&
        action === "complete"
      ) {
        const key =
          url.searchParams.get("key");

        const uploadId =
          url.searchParams.get(
            "uploadId"
          );

        if (!uploadCapability) {
          return json(
            {
              error:
                "Upload capability is required",
            },
            401,
            cors
          );
        }

        try {
          validateCapabilityKey(
            uploadCapability,
            key
          );
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unauthorized",
            },
            403,
            cors
          );
        }

        if (!key || !uploadId) {
          return json(
            {
              error:
                "key and uploadId are required",
            },
            400,
            cors
          );
        }

        const body =
          (await request.json()) as {
            parts?: Array<{
              partNumber: number;
              etag: string;
            }>;
          };

        if (
          !Array.isArray(body.parts) ||
          body.parts.length === 0
        ) {
          return json(
            {
              error:
                "parts are required",
            },
            400,
            cors
          );
        }

        const parts =
          body.parts.map(
            (part) => ({
              partNumber:
                part.partNumber,

              etag:
                part.etag,
            })
          );

        const multipart =
          env.MEDIA_BUCKET.resumeMultipartUpload(
            key,
            uploadId
          );

        const object =
          await multipart.complete(
            parts
          );

        /*
         * Remove multipart marker objects.
         */

        const prefix =
          `${PART_PREFIX}${uploadId}/`;

        let cursor:
          | string
          | undefined;

        do {
          const result =
            await env.MEDIA_BUCKET.list({
              prefix,
              cursor,
              limit: 1000,
            });

          if (
            result.objects.length > 0
          ) {
            await env.MEDIA_BUCKET.delete(
              result.objects.map(
                (object: R2Object) =>
                  object.key
              )
            );
          }

          cursor =
            result.truncated
              ? result.cursor
              : undefined;
        } while (cursor);

        const completionProof =
          await createCompletionProof(
            {
              videoId:
                uploadCapability.videoId,
              objectKey: key,
              uploadId,
              size: object.size,
              etag: object.httpEtag,
            },
            env
          );

        return json(
          {
            success: true,
            key,
            etag: object.httpEtag,
            size: object.size,
            completionProof,
          },
          200,
          cors
        );
      }

      /* --------------------------------------------------
         MULTIPART: ABORT
      -------------------------------------------------- */

      if (
        request.method === "DELETE" &&
        action === "abort"
      ) {
        const key =
          url.searchParams.get("key");

        const uploadId =
          url.searchParams.get(
            "uploadId"
          );

        if (!uploadCapability) {
          return json(
            {
              error:
                "Upload capability is required",
            },
            401,
            cors
          );
        }

        try {
          validateCapabilityKey(
            uploadCapability,
            key
          );
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unauthorized",
            },
            403,
            cors
          );
        }

        if (!key || !uploadId) {
          return json(
            {
              error:
                "key and uploadId are required",
            },
            400,
            cors
          );
        }

        const multipart =
          env.MEDIA_BUCKET.resumeMultipartUpload(
            key,
            uploadId
          );

        await multipart.abort();

        /*
         * Remove marker objects.
         */

        const prefix =
          `${PART_PREFIX}${uploadId}/`;

        let cursor:
          | string
          | undefined;

        do {
          const result =
            await env.MEDIA_BUCKET.list({
              prefix,
              cursor,
              limit: 1000,
            });

          if (
            result.objects.length > 0
          ) {
            await env.MEDIA_BUCKET.delete(
              result.objects.map(
                (object: R2Object) =>
                  object.key
              )
            );
          }

          cursor =
            result.truncated
              ? result.cursor
              : undefined;
        } while (cursor);

        return json(
          {
            success: true,
          },
          200,
          cors
        );
      }

      return json(
        {
          error: "Not found",
        },
        404,
        cors
      );
    } catch (error) {
      console.error(
        "STREAMFLIX R2 Worker error:",
        error
      );

      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Internal Worker error",
        },
        500,
        corsHeaders(request)
      );
    }
  },
} satisfies ExportedHandler<Env>;