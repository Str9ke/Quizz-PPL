# Belgian NOTAM Retrieval

This project automates the retrieval of Belgian NOTAMs from the Skeyes secure portal. It uses Python to log in to the portal, fetch NOTAM data, and save it in an HTML format.

## Project Structure

```
belgian-notam-retrieval
├── .github
│   └── workflows
│       └── main.yml
├── src
│   └── main.py
├── .gitignore
├── requirements.txt
└── README.md
```

## Setup Instructions

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/<username>/belgian-notam-retrieval.git
   cd belgian-notam-retrieval
   ```

2. **Install Dependencies**:
   Make sure you have Python 3.x installed. Then, install the required packages:
   ```bash
   pip install -r requirements.txt
   ```

3. **Add Secrets in GitHub**:
   - Go to your GitHub repository.
   - Click on "Settings".
   - In the left sidebar, click on "Secrets and variables" then "Actions".
   - Click on "New repository secret".
   - Add `SKEYES_USER` and `SKEYES_PASS` with your Skeyes credentials.

4. **Enable GitHub Pages**:
   - Go to your GitHub repository.
   - Click on "Settings".
   - In the left sidebar, click on "Pages".
   - Under "Source", select the branch (usually `main`) and the folder (root or `/docs`).
   - Click "Save". Your file `notams_belgique.html` will be accessible via `https://<username>.github.io/<repo>/notams_belgique.html`.

5. **Managing GITHUB_TOKEN Permissions**:
   - In the repository settings, navigate to "Actions".
   - Under "General", find "Workflow permissions".
   - Select "Read and write permissions" to allow the workflow to push changes to the repository.

## Usage

To run the script manually, execute the following command:
```bash
python src/main.py
```

This will log in to the Skeyes portal, retrieve the NOTAMs, and save them to `notams_belgique.html`.

## Additional Notes

- If requests fail due to WAF protection, consider using `cloudscraper` or rotating the User-Agent.
- For JSON output, modify the parsing logic to structure the NOTAM data in JSON format for easier integration with your web application.