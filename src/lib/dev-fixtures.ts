/* ------------------------------------------------------------------ */
/*  Dev-only fixtures                                                  */
/*                                                                     */
/*  When NEXT_PUBLIC_DEV_DEBUG=true the landing page pre-populates     */
/*  state from these constants so you can skip resume upload and the   */
/*  parse-resume / generate-opening API round-trips.                   */
/* ------------------------------------------------------------------ */

import type { VasanthOpening } from "@/lib/opening";

/** Candidate name shown in the UI. */
export const DEV_NAME = "Aswathy B";

/** Pre-selected interview track. */
export const DEV_INTERVIEW_TRACK = "frontend React";

/** Resume markdown (the output the parse-resume API would return). */
export const DEV_RESUME_MARKDOWN = `# Aswathy B

Email: aswathybicon@gmail.com | Phone: +91 8593997422 | [LinkedIn](https://www.linkedin.com/in/aswathy-b-9a1b0b236) | [GitHub](https://github.com/aswathybicon)

## Education

### B. Tech in Data Science

**Sai University, Chennai** | Aug 2021 - May 2025

Relevant Coursework: Linear algebra, Probability and Statistics, Numerical methods, Data structures and algorithms, Database management systems, NLP, Operating Systems, Computer Networks.

CGPA: 7.55

### Higher Secondary - Science

**Sobha Icon Higher Secondary School, Palakkad, Kerala** | Jun 2020 - Apr 2021

Score: 98.6%

## Skills

**Programming Languages:** Python, SQL

**Data Science:** Machine learning, Data Cleansing, Data Preprocessing, Data Visualisation, Deep Learning

**Tools and Technologies:** Git, Linux, Jupyter, Colab, Pandas, Numpy, Scikit-learn, Matplotlib, Seaborn

**Soft skills:** Communication, Team Collaboration, Consistency, Time and Project management, Leadership and mentoring, Problem solving and analytical thinking, Research.

## Experience

### Machine Learning Engineer - Intern

**One Data Software Solutions** | May 2026 - Present

Worked on developing AI-powered business solutions using Amazon Bedrock, QuickSight, and Terraform, focused on:

*   Building LLM-based chat agents and enhancing model responses using prompt engineering.
*   Creating business dashboards and automating AWS cloud infrastructure using Terraform.
*   Integrating AI services and supporting deployment, testing, and workflow automation tasks.

### Web Developer - Intern

**BIDS Associates** | Dec 2025 - March 2026

Worked on developing and managing business websites, focused on:

*   Designing responsive web pages using HTML, CSS, and JavaScript.
*   Building and maintaining websites using Odoo CMS.
*   Integrating forms and optimizing content for better user experience and SEO.
*   Supported website updates, deployment, and basic maintenance tasks.

### Artificial Intelligence/Machine Learning - Intern

**RBG.AI** | Jan 2025 - Oct 2025

Gained hands-on experience with live projects, focused on:

*   Extracting structured data from PDF documents.
*   Converting PDF data into JSON format for easier processing and analysis.
*   Conducting pattern analysis to identify common issues in OCR-extracted data reducing recurring errors.

Worked on speech embeddings models for audio classification. Acquired knowledge on Speech to Text models to check the model performance for various coastal languages.

### Data Analytics - Intern

**Apton Works Pvt Ltd** | Jul 2022 - Aug 2022

*   Analyzed customer support data from Twitter using SQL, Pandas, and Python to assess company response levels.
*   Extracted, cleaned, and visualized large datasets from Kaggle, and transformed CSV files into Pandas dataframes for deeper insights.
*   Applied SQL queries to perform data analysis and presented findings using data visualization tools like Grafana.
*   Developed problem-solving skills by identifying patterns and trends in the data.

## Projects

### Superconductivity Data

Machine learning

*   Developed a predictive model to estimate the critical temperature of superconductors based on atomic properties.
*   Used various regression models including Linear Regression, Polynomial Regression, Lasso, Ridge, ElasticNet, Decision trees, Random Forest and AdaBoost.
*   Applied feature scaling, PCA for dimensionality reduction, and cross-validation for model validation.
*   Tools used are Python, Scikit-learn, Pandas, NumPy, Matplotlib.

### Image classification

Deep learning

*   Classified car images to different categories using Convolutional Neural Networks, used Batch Normalization and Dropout layers to reduce overfitting.
*   Fine-tuned the models with selective layer freezing for optimal performance.
*   Evaluated model performance using accuracy, precision, recall, and F1-score to ensure robust classification across different car categories.
*   Tools used are Python, TensorFlow, Keras.

### Cybersecurity Research Paper

Cybersecurity

*   Researched cybersecurity risks and vulnerabilities faced by children and teens providing an understanding of digital threats. Examined the importance of cybersecurity education for young users, emphasizing the need for proactive measures to protect personal safety, and privacy.

### Digital Logic Design

Quine-McCluskey Method

*   Implemented essential steps including primary grouping, prime implicant table creation, and chart generation to simplify Boolean expressions.
*   Demonstrated practical understanding by converting ASCII values into minterms and solving real-world examples.

## Certifications

*   **Certified in Python** / Great Learning [Introduction to Python Programming]
*   **Certified in Machine Learning** / Great Learning [Machine Learning]

## Achievements

*   Gavel Club Involvement - Recognized for Most Improved Speaker and Best Speaker awards
*   Volleyball State Player awards, represented Kerala in State Mini Volleyball Championships.
*   Awarded 100% scholarships at Sobha Icon - HSE and Sai University for academic merits.

## Declaration

I hereby declare that all the information provided in this resume is true, complete, and correct to the best of my knowledge and belief.

Aswathy B

Palakkad`;

/** Opening envelope (the output the generate-opening API would return). */
export const DEV_OPENING: VasanthOpening = {
  opening: {
    question: "Please tell me about yourself.",
  },
  follow_up_plans: [
    {
      decision: "clarify_current_focus_from_data_to_frontend",
      ask_if: [
        "candidate does not explicitly mention frontend/web development as their primary interest or recent focus during their introduction",
      ],
      skip_if: [
        "candidate explicitly states a strong interest or recent focus on frontend/web development during their introduction",
        "candidate expresses a desire to pursue frontend roles during their introduction",
      ],
      question:
        "Your resume highlights a lot of data science and machine learning experience. Could you tell me more about your interest in frontend React?",
      rationale:
        "The resume has significant data science/ML experience and only one web development internship (Odoo CMS, HTML/CSS/JS, no React). Clarify the candidate's current focus and motivation for a frontend React role to ensure alignment with the requested interview track.",
      resume_signals: [
        "B. Tech in Data Science",
        "Machine Learning Engineer - Intern",
        "Artificial Intelligence/Machine Learning - Intern",
        "Data Analytics - Intern",
        "Skills: Machine learning, Data Cleansing, Data Preprocessing, Data Visualisation, Deep Learning",
        "Projects: Superconductivity Data (ML), Image classification (Deep learning)",
      ],
    },
    {
      decision: "explore_web_dev_internship_depth",
      ask_if: [
        "candidate mentions their web developer internship but not in great detail regarding specific technologies or challenges",
        "candidate confirms interest in frontend but hasn't elaborated on practical experience",
      ],
      skip_if: [
        "candidate provides a detailed account of their web developer internship including technologies, challenges, and lessons learned relevant to frontend React during their introduction",
        "candidate indicates a stronger, more recent, or personally driven frontend project experience",
      ],
      question:
        "You mentioned your web developer internship at BIDS Associates. Could you elaborate on any specific challenges you faced or interesting aspects of building and maintaining those websites?",
      rationale:
        "The web developer internship is the most relevant experience for frontend, but the resume description is brief and doesn't mention React. This question aims to explore the depth of their web development understanding and practical skills, even if it wasn't React-specific.",
      resume_signals: [
        "Web Developer - Intern at BIDS Associates",
        "Designing responsive web pages using HTML, CSS, and JavaScript",
        "Building and maintaining websites using Odoo CMS",
      ],
    },
    {
      decision: "understand_transition_to_frontend_react_motivation",
      ask_if: [
        "candidate expresses a general interest in frontend without clearly linking it to specific past experiences or future goals",
        "candidate's introduction makes it clear they are transitioning from a data-focused background to frontend",
      ],
      skip_if: [
        "candidate explicitly states a clear, well-reasoned motivation for pursuing frontend React roles and how it aligns with their skills/interests during their introduction",
        "candidate has extensive, recent, and relevant frontend experience that naturally leads to a React discussion",
      ],
      question:
        "Given your background in data science, what led you to pursue opportunities in frontend development, and specifically with React?",
      rationale:
        "The candidate's primary background is data science. Understanding their motivation for shifting to frontend React is crucial to assess their commitment, self-directed learning, and long-term fit for the role.",
      resume_signals: [
        "Overall resume heavily weighted towards Data Science/ML",
        "Requested Interview Track: frontend React",
      ],
    },
  ],
  max_follow_ups_to_ask: 1,
  transition_to_technical:
    "Once the candidate's primary interest in frontend React is confirmed and their relevant experience or motivation for the shift is understood, transition to technical questions.",
};
