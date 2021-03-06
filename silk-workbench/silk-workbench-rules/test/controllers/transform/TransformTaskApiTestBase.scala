package controllers.transform


import helper.IntegrationTestTrait
import org.scalatestplus.play.PlaySpec
import org.silkframework.config.DefaultConfig
import org.silkframework.util.ConfigTestTrait
import play.api.Logger
import play.api.libs.json._
import play.api.libs.ws.WS

/**
  * Base trait for transformation API tests.
  */
trait TransformTaskApiTestBase extends PlaySpec with IntegrationTestTrait with ConfigTestTrait {

  protected def log: Logger = Logger(getClass.getName)

  def printResponses: Boolean

  protected val project = "TransformTestProject"
  protected val task = "TestTransform"

  override def workspaceProvider = "inMemory"

  override def propertyMap = Map("vocabulary.manager.plugin" -> Some("rdfFiles"))

  protected override def routes = Some("test.Routes")

  def jsonGetRequest(url: String): JsValue = {
    var request = WS.url(url)
    request = request.withHeaders("Accept" -> "application/json")
    val response = request.get()
    val json = checkResponse(response).json

    if(printResponses) {
      println(s"Get request on $url resulting in:\n" + Json.prettyPrint(json))
    }

    json
  }

  def jsonPutRequest(url: String)(json: String): JsValue = {
    var request = WS.url(url)
    request = request.withHeaders("Accept" -> "application/json")
    val response = request.put(Json.parse(json))
    val responseJson = checkResponse(response).json

    if(printResponses) {
      println(s"Put request on $url resulting in:\n" + Json.prettyPrint(responseJson))
    }

    responseJson
  }

  def jsonPostRequest(url: String)(json: String): JsValue = {
    var request = WS.url(url)
    request = request.withHeaders("Accept" -> "application/json")
    val response = request.post(Json.parse(json))
    val responseJson = checkResponse(response).json

    if(printResponses) {
      println(s"Post request on $url resulting in:\n" + Json.prettyPrint(responseJson))
    }

    responseJson
  }

  def waitForCaches(task: String): Unit = {
    var cachesLoaded = false
    do {
      val response = jsonGetRequest(s"$baseUrl/workspace/projects/$project/tasks/$task/cachesLoaded")
      cachesLoaded = response.as[JsBoolean].value
      if(!cachesLoaded)
        Thread.sleep(1000)
    } while(!cachesLoaded)
  }

  def retrieveRuleOrder(): Seq[String] = {
    val fullTree = jsonGetRequest(s"$baseUrl/transform/tasks/$project/$task/rules")
    (fullTree \ "rules" \ "propertyRules").as[JsArray].value.map(r => (r \ "id").as[JsString].value)
  }

  implicit class JsonOperations(json: JsValue) {

    def mustMatchJson(expectedJson: String): Unit = {
      val expectedJsonValue = Json.parse(expectedJson)
      json mustBe expectedJsonValue
    }
  }

}
