import Aurora from "./components/Aurora";
import CreateJsonContainer from "./createJsonComponent/CreateJsonContainer";
import { Col, Row, Typography } from "antd";
import stars from "./createJsonComponent/ai-stars.png";
import ExampleDocx from "./createJsonComponent/ExampleDocx";
import exampleDocxInput from "./assets/exampleDocxInput.docx";

const { Title, Text } = Typography;

function App() {
  return (
    <div className="relative min-h-screen w-full bg-[#07162f] overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <Aurora
          colorStops={["#3A29FF", "#FF94B4", "#FF3232"]}
          blend={0.5}
          amplitude={1.0}
          speed={0.5}
        />
      </div>

{/* Foreground */}
<div className="relative z-10">
  <Row justify="center" className="w-full !mb-1">
    <Col>

      <Row align="middle" justify="center" wrap={false} className="!flex-nowrap">
        <Col flex="none">
          <img
            src={stars}
            alt="AI logo"
            style={{
              width: 40,
              height: 40,
              objectFit: "contain",
              display: "block",
              marginTop: "12px", // match Title's mt-12
              marginRight: 8,
            }}
          />
        </Col>

        <Col flex="none">
          <Title level={1} className="!m-0 !mt-2 !text-white">
            AI Convertor
          </Title>
          <ExampleDocx href={exampleDocxInput} downloadName="ExampleInput.docx" />
        </Col>
      </Row>
    </Col>
  </Row>

  <Row justify="center" className="w-full ml-5">
    <Text className="!m-0 !text-gray-300 text-center">
      Convert any Docx / PDF to Json files
    </Text>
  </Row>
</div>


    <div className="w-[80%] !mt-5 mx-auto">
        <CreateJsonContainer />
    </div>

      </div>
  );
}

export default App;
