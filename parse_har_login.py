"""Parse HAR file(s) to extract the login sequence to ops.skeyes.be.

Analyzes both HAR files to find:
- Login/auth redirects (302s, CAS, etc.)
- POST requests with credentials
- Set-Cookie headers establishing sessions
- The full pre-authentication flow
"""
import json

HAR_FILES = [
    r"d:\Quizz PPL\ops.skeyes.be_Archive [26-03-08 10-18-09].har",
    r"d:\Quizz PPL\ops.skeyes.be_Archive [26-03-08 10-02-41].har",
]


def get_header(headers, name):
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return None


def get_all_headers(headers, name):
    return [h["value"] for h in headers if h["name"].lower() == name.lower()]


def print_entry(i, entry):
    req = entry["request"]
    resp = entry["response"]
    method = req["method"]
    url = req["url"]
    referer = get_header(req["headers"], "Referer")
    status = resp["status"]
    location = get_header(resp["headers"], "Location")
    set_cookies = get_all_headers(resp["headers"], "Set-Cookie")
    cookie_req = get_header(req["headers"], "Cookie")

    print(f"--- Request #{i+1} ---")
    print(f"  Method: {method}")
    print(f"  URL: {url}")
    print(f"  Referer: {referer}")
    print(f"  Request Cookies: {cookie_req}")
    print(f"  Status: {status} {resp.get('statusText', '')}")
    if location:
        print(f"  Redirect Location: {location}")
    if set_cookies:
        for sc in set_cookies:
            print(f"  Set-Cookie: {sc}")
    if method == "POST":
        post_data = req.get("postData", {})
        if post_data:
            mime = post_data.get("mimeType", "")
            text = post_data.get("text", "")
            params = post_data.get("params", [])
            print(f"  POST mimeType: {mime}")
            if text:
                print(f"  POST body: {text}")
            if params:
                print("  POST params:")
                for p in params:
                    print(f"    {p.get('name', '?')} = {p.get('value', '?')}")
    print()


for har_path in HAR_FILES:
    with open(har_path, "r", encoding="utf-8") as f:
        har = json.load(f)

    entries = har["log"]["entries"]

    print("=" * 80)
    print(f"HAR FILE: {har_path}")
    print(f"Total entries: {len(entries)}")
    for p in har["log"].get("pages", []):
        print(f"  Page: {p.get('title', '?')}")
    print("=" * 80)

    # Part 1: First 10 requests (unfiltered)
    print("\n>> FIRST 10 REQUESTS (unfiltered):")
    for i, entry in enumerate(entries[:10]):
        print_entry(i, entry)

    # Part 2: All requests before remoteSensing/opmet
    print("\n>> ALL ops.skeyes.be REQUESTS BEFORE remoteSensing/opmet:")
    count = 0
    for i, entry in enumerate(entries):
        url = entry["request"]["url"]
        if "remoteSensing" in url or "opmet" in url:
            print(f"[STOP] Hit remoteSensing/opmet at request #{i+1}: {url}")
            break
        if "ops.skeyes.be" in url:
            print_entry(i, entry)
            count += 1
    print(f"  => Found {count} ops.skeyes.be requests before remoteSensing/opmet")

    # Part 3: Show login-relevant requests (redirects, Set-Cookie, POSTs, auth URLs)
    print("\n>> LOGIN-RELEVANT REQUESTS (redirects, Set-Cookie, POSTs, auth/login/cas URLs):")
    login_count = 0
    for i, entry in enumerate(entries):
        req = entry["request"]
        resp = entry["response"]
        url = req["url"]
        method = req["method"]
        status = resp["status"]
        location = get_header(resp["headers"], "Location")
        set_cookies = get_all_headers(resp["headers"], "Set-Cookie")

        is_login_url = any(kw in url.lower() for kw in ["login", "auth", "cas", "ticket", "signin", "sso"])
        is_redirect = 300 <= status < 400
        is_post = method == "POST"
        has_set_cookie = len(set_cookies) > 0

        if is_login_url or is_redirect or has_set_cookie:
            print_entry(i, entry)
            login_count += 1

    if login_count == 0:
        print("  [NONE FOUND] No login/auth redirects or Set-Cookie headers in this HAR.")
    print(f"  => Found {login_count} login-relevant requests")
    print("\n")
