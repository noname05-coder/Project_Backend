import express from "express";
import dotenv from 'dotenv';

const cors = require('cors');
dotenv.config();

const app = express();
app.use(cors());

import { mlRouter } from "./routes/ML_Int";
import { uploadRouter } from './routes/Tech_Int';
import { hr_data } from './routes/HR_Int';


app.use(express.json());

app.use('/api/v1/ml', mlRouter);
app.use('/api/v1/dev',uploadRouter);
app.use('/api/v1/hr',hr_data);

app.listen(3000);