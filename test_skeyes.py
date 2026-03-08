import os
import cloudscraper

def main():
    username = os.getenv("SKEYES_USER")
    password = os.getenv("SKEYES_PASS")
    
    if not username or not password:
        print("Missing credentials! Cannot proceed. SKEYES_USER and SKEYES_PASS must be set.")
        return

    # Use cloudscraper to bypass WAF
    session = cloudscraper.create_scraper(
        browser={
            'browser': 'chrome',
            'platform': 'windows',
            'desktop': True
        }
    )
    
    login_url = "https://ops.skeyes.be/opersite/login.do"
    home_url = "https://ops.skeyes.be/opersite/home.do"
    opmet_init_url = "https://ops.skeyes.be/opersite/opmeteoindex.do?cmd=init"
    
    print("--- 1. Getting Login Page ---")
    res_init = session.get(login_url)
    print(f"Status: {res_init.status_code}")
    print(f"Cookies: {session.cookies.get_dict()}")
    
    print("\n--- 2. Performing Login ---")
    login_payload = {
        "j_username": username,
        "j_password": password
    }
    # login.do usually uses POST
    res_login = session.post(login_url, data=login_payload)
    print(f"Status: {res_login.status_code}")
    print(f"Cookies after login: {session.cookies.get_dict()}")
    
    print("\n--- 3. Hitting Home.do (Establishing Session State/Referer) ---")
    res_home = session.get(home_url)
    print(f"Status: {res_home.status_code}")
    
    print("\n--- 4. Accessing OPMET Init ---")
    # Using the Referer header to mimic clicking from the home menu
    headers = {
        'Referer': home_url
    }
    res_opmet = session.get(opmet_init_url, headers=headers)
    print(f"Status: {res_opmet.status_code}")
    print(f"Headers: {dict(res_opmet.headers)}")
    
    contains_login = 'name="loginForm"' in res_opmet.text
    print(f"\nResponse contains 'name=\"loginForm\"'? {contains_login}")
    
    if contains_login:
        print("-> The server redirected/returned to the login page. Authentication or Session context failed.")
    else:
        print("-> Success! Real OPMET content was returned.")

if __name__ == "__main__":
    main()
