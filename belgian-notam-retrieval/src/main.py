import os
import requests
from bs4 import BeautifulSoup

def retrieve_notams():
    # Retrieve credentials from environment variables
    username = os.getenv('SKEYES_USER')
    password = os.getenv('SKEYES_PASS')

    # Start a session
    session = requests.Session()

    # Login to the Skeyes portal
    login_url = 'https://skeyes.be/login'  # Replace with the actual login URL
    payload = {
        'username': username,
        'password': password
    }
    session.post(login_url, data=payload)

    # Fetch NOTAM data
    notam_url = 'https://skeyes.be/notams'  # Replace with the actual NOTAMs URL
    response = session.get(notam_url)

    # Parse the HTML
    soup = BeautifulSoup(response.content, 'html.parser')
    notams = soup.find_all('div', class_='notam')  # Adjust the selector based on actual HTML structure

    # Save NOTAMs to an HTML file
    with open('notams_belgique.html', 'w', encoding='utf-8') as file:
        for notam in notams:
            file.write(str(notam))

if __name__ == '__main__':
    retrieve_notams()