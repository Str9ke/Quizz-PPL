"""Sonde : un vrai Chromium (Playwright) franchit-il le WAF Azure de Skeyes depuis un runner GitHub ?"""
import asyncio
from playwright.async_api import async_playwright

URL = "https://ops.skeyes.be/opersite/login.do"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
        ctx = await browser.new_context(locale="fr-BE", user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"))
        page = await ctx.new_page()
        resp = await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        print("first status:", resp.status if resp else None)
        for i in range(12):
            await page.wait_for_timeout(2500)
            title = await page.title()
            has_form = await page.locator("form[name=loginForm], input[type=password]").count()
            print(f"t+{(i+1)*2.5:.0f}s title={title!r} url={page.url} login_form={has_form}")
            if has_form:
                break
        print("cookies:", [c["name"] for c in await ctx.cookies()])
        text = (await page.inner_text("body"))[:800].replace("\n", " | ")
        print("body text:", text)
        await browser.close()


asyncio.run(main())
