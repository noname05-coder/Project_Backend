import express from "express";
import dotenv from 'dotenv';
import './webSockets/HR_ws';

dotenv.config();

const app = express();

import { userRouter } from './routes/user';
import { uploadRouter } from './routes/upload';
import { hr_data } from './routes/HR_Int';


app.use(express.json());


app.use('/api/v1/user',userRouter);
app.use('/api/v1/upload',uploadRouter);
app.use('/api/v1/hr',hr_data);

app.listen(3000);