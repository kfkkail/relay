const descriptions = {
  access_denied: "seller denied automated access",
  rate_limited: "seller rate limited the request",
  http_error: "seller returned an unsuccessful response",
  timeout: "seller request timed out",
  unsafe_destination: "destination failed public-network checks",
  response_too_large: "seller response exceeded the size limit",
  request_limit: "page exceeded the request limit",
  network_error: "seller request failed",
};

export class SellerPageError extends Error {
  constructor(code, url, { httpStatus, networkCode } = {}) {
    let host = "unknown";
    try {
      host = new URL(url).hostname;
    } catch {
      /* Keep diagnostics bounded. */
    }
    const diagnostic = {
      code: Object.hasOwn(descriptions, code) ? code : "network_error",
      host: host.slice(0, 253),
      ...(Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599
        ? { http_status: httpStatus }
        : {}),
      ...(typeof networkCode === "string" &&
      networkCode.length > 0 &&
      networkCode.length <= 40 &&
      !/[^A-Z0-9_]/.test(networkCode)
        ? { network_code: networkCode }
        : {}),
    };
    super(
      `${diagnostic.host}: ${descriptions[diagnostic.code]}${diagnostic.http_status ? ` (HTTP ${diagnostic.http_status})` : ""}${diagnostic.network_code ? ` (${diagnostic.network_code})` : ""}`,
    );
    this.name = "SellerPageError";
    this.diagnostic = diagnostic;
  }
}

export function sellerPageError(error, url) {
  if (error instanceof SellerPageError) return error;
  const message = error?.message || "";
  const code = error?.code || error?.cause?.code;
  const category =
    /^(unsafe_|invalid_url)/i.test(message) || code === "ERR_INVALID_URL"
      ? "unsafe_destination"
      : message === "seller_page_too_large"
        ? "response_too_large"
        : error?.name === "TimeoutError" ||
            code === "ETIMEDOUT" ||
            error?.name === "AbortError"
          ? "timeout"
          : "network_error";
  return new SellerPageError(category, url, { networkCode: code });
}
