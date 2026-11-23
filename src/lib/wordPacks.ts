/**
 * Optional word packs for the personal dictionary. Each list contains only words that
 * Harper flagged as misspelled when this file was generated (words it already knows
 * are left out), so enabling a pack never hides a real mistake it would otherwise catch
 * in ordinary English.
 */

export type PackId = 'indian' | 'tech';

export interface WordPack {
  id: PackId;
  title: string;
  description: string;
  words: string[];
}

const split = (s: string) => s.trim().split(/\s+/);

export const WORD_PACKS: Record<PackId, WordPack> = {
  indian: {
    id: 'indian',
    title: 'Indian names & places',
    description: 'Common first names, surnames, cities, states, festivals and everyday Indian-English words.',
    words: split(`
  Aarav Aditya Arjun Atharv Atharva Ayaan Ishaan Vihaan Vivaan Reyansh Sai Rohan Rahul Amit Ankit
  Ankur Anurag Abhishek Akash Akshay Aman Anil Anand Ashok Ajay Vijay Sanjay Suresh Ramesh Mahesh
  Rajesh Dinesh Ganesh Naresh Mukesh Rakesh Hitesh Nitin Sachin Sandeep Pradeep Kuldeep Deepak Gaurav
  Hemant Jayesh Kunal Manish Mayank Mohit Nikhil Nilesh Pankaj Pranav Prashant Prateek Rajat Ravi
  Rishabh Sahil Saurabh Shubham Siddharth Sumit Tarun Tushar Varun Vikas Vikram Vinay Vishal Yash
  Yogesh Omkar Onkar Tejas Chinmay Shreyas Aniket Swapnil Sagar Mangesh Parag Sunil Sudhir Girish
  Kiran Mohan Arun Karthik Kartik Venkatesh Srinivas Subramanian Murali Balaji Senthil Prakash Gopal
  Govind Hari Raghav Madhav Keshav Rajeev Sameer Zaid Imran Irfan Arif Farhan Rohit Virat Dhruv Ritesh
  Lokesh Umesh Shailesh Kamlesh Bhavesh Paresh Jignesh Chirag Hardik Krunal Darshan Nachiket Soham
  Advait Arnav Kabir Ved Shaurya Rudra Neel Ojas Pratik Ashutosh Abhinav Anirudh Devendra Dhananjay
  Hrishikesh Jitendra Mahendra Narendra Rajendra Surendra Upendra Yatin Sanket Sushant Sourabh Vaibhav
  Vedant Vineet Yuvraj Pooja Priya Neha Sneha Anjali Ananya Aishwarya Aditi Divya Kavya Kavita Sunita
  Geeta Seema Rekha Meena Saraswati Shweta Swati Shruti Pallavi Payal Komal Nisha Riya Isha Ishita
  Diya Saanvi Aadhya Anika Kiara Tanvi Sakshi Shivani Sonali Rupali Vaishnavi Madhuri Manisha Prachi
  Radhika Rashmi Smita Snehal Varsha Vidya Yamini Bhavana Archana Aparna Deepika Harini Janani Keerthi
  Lavanya Nandini Pranjal Prerna Ritu Rucha Sayali Shraddha Tanaya Gayatri Mrunal Manasi Ketaki
  Ashwini Harshada Dhanashree Ayesha Zoya Simran Navjot Gurpreet Harpreet Manpreet Jaspreet Amandeep
  Harjit Baldev Sukhwinder Parminder Rupinder Kamaljeet Anushka Shalini Sangeeta Poonam Mamta Usha
  Asha Jyoti Preeti Rani Suman Sapna Neelam Rachana Rutuja Sanika Siddhi Mansi Ankita Akanksha Apeksha
  Bhagyashree Devika Gauri Jui Kajal Mitali Namrata Purva Rasika Shital Sonal Tejaswini Urmila
  Vrushali Sharma Verma Agarwal Aggarwal Agrawal Bansal Goyal Goel Mehta Desai Joshi Kulkarni
  Deshpande Deshmukh Patil Pawar Jadhav Shinde Gaikwad Chavan Bhosale Bhonsle Kadam Salunkhe Bhasme
  Apte Gokhale Ranade Bhide Phadke Paranjpe Menon Pillai Iyer Iyengar Reddy Rao Naidu Chowdary
  Choudhary Chaudhary Kumar Yadav Mishra Tiwari Pandey Dubey Tripathi Chaturvedi Srivastava Saxena
  Mathur Kapoor Khanna Malhotra Arora Bhatia Sethi Ahuja Bajaj Chauhan Rathore Rajput Thakur Banerjee
  Chatterjee Mukherjee Dutta Ghosh Chakraborty Bhattacharya Sinha Prasad Mahajan Sandhu Sidhu Dhillon
  Grewal Bhat Hegde Shetty Kamath Pai Gowda Naik Krishnan Subramaniam Venkataraman Swamy Ansari
  Qureshi Siddiqui Syed Mirza Fernandes Dsouza Pereira Rodrigues Wagh Sawant Shirke Thorat Jagtap
  Bhagat Dixit Bhatt Trivedi Vyas Pathak Upadhyay Awasthi Bajpai Shukla Rawat Negi Bisht Kashyap Garg
  Mittal Singhal Jindal Khandelwal Maheshwari Oswal Lodha Rane Parab Gawde Chitnis Karnik Sathe Limaye
  Joglekar Godbole Lele Sahasrabuddhe Bapat Damle Khare Sardesai Waghmare Kamble Gade Noida Gurugram
  Gurgaon Ahmedabad Vadodara Nashik Aurangabad Kolhapur Solapur Satara Sangli Ratnagiri Ranchi
  Bhubaneswar Guwahati Dehradun Shimla Jammu Mangaluru Mangalore Visakhapatnam Panaji Rajasthan
  Karnataka Kerala Telangana Andhra Pradesh Nadu Odisha Bihar Jharkhand Uttarakhand Himachal Haryana
  Meghalaya Manipur Mizoram Nagaland Tripura Chhattisgarh Prayagraj Udaipur Jodhpur Rishikesh Haridwar
  Lonavala Mahabaleshwar Navi Kalyan Dombivli Pimpri Chinchwad Hinjewadi Kothrud Baner Wakad Andheri
  Bandra Powai Dadar Holi Ganpati Navratri Dussehra Pongal Onam Baisakhi Raksha Bandhan Makar
  Sankranti Gudi Padwa Durga Puja Janmashtami lakh lakhs crore crores paise Aadhaar Paytm PhonePe
  Swiggy Zomato Flipkart Infosys Wipro TCS HCL Tata Mahindra Jio Airtel IIT IIM UPSC JEE NEET CBSE
  ICSE
`),
  },
  tech: {
    id: 'tech',
    title: 'Tech terms',
    description: 'Programming languages, frameworks, tools, cloud services and developer jargon.',
    words: split(`
  js tsx jsx NodeJS npx pnpm Rollup Rolldown esbuild SWC Nuxt SvelteKit Redux Zustand Jotai tRPC SCSS
  FastAPI Keras scikit Symfony CentOS kubectl RabbitMQ Kibana Logstash Nginx GCP EC2 S3 Supabase SSO
  SAML VSCode PyCharm WebStorm fullstack env envs CSRF XSS SRE OpenAPI useEffect useState useMemo
  useCallback useRef Vitest Chai Prisma Sequelize TypeORM NestJS Fastify Koa Hono Zod Axios lodash
  dayjs RxJS NgRx Pinia Vuex Astro Webpacker Turborepo Nx Lerna commitlint dotenv Jinja EJS Gunicorn
  uvicorn Databricks dbt PowerBI Kubeflow MLflow HuggingFace ONNX cuDNN SFTP VPC IAM RBAC JWK JWKS
  PKCE OIDC ETL ELT PaaS IaaS SLO SLI KPI KPIs OKR OKRs POC PRD SDLC NewRelic PagerDuty Opsgenie
  Splunk Zipkin Jaeger OpenTelemetry Istio Podman containerd CRI kubelet etcd autoscaling autoscaler
  Kustomize ArgoCD Tekton CircleCI TravisCI Buildkite Codecov SonarQube Snyk Dependabot pytest
  unittest JUnit TestNG RSpec Minitest PHPUnit xUnit NUnit
`),
  },
};
