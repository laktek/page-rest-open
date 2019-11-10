import * as express from 'express';
import { fetch }  from './fetch';

const app = express();
const port = 3000; // TODO: Make this configurable

app.get('/', fetch);
app.listen(port, () => console.log(`Page.REST is listening on port ${port}!`))
